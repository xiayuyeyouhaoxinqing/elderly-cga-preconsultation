"""门诊任务的文书绑定、患者确认和采集控制。"""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.configs.app_config import get_app_config
from app.errors.codes import ErrorCode
from app.errors.handlers import AppError
from app.models.patient_portal import ConsentDocument, ConsentDocumentVersion, ConsentRecord
from app.models.patient_task import CareTask, Patient, PatientEncounter
from app.schemas.assessment_consent import (
    AssessmentConsentDecision,
    AssessmentConsentDto,
    AssessmentConsentStatus,
)
from app.schemas.patient import OUTPATIENT_ACTIVE

OUTPATIENT_CONSENT_TYPE = "outpatient_assessment"


def bind_outpatient_consent(db: Session, task: CareTask, *, now: datetime) -> None:
    """为新任务绑定当前已发布文书。由创建任务事务统一提交。"""
    code = (get_app_config().security.outpatient_consent_document_code or "").strip()
    if not code:
        return
    version = db.scalar(
        select(ConsentDocumentVersion)
        .join(ConsentDocument)
        .where(
            ConsentDocument.consent_code == code,
            ConsentDocument.consent_type == OUTPATIENT_CONSENT_TYPE,
            ConsentDocument.status == "active",
            ConsentDocument.deleted == 0,
            ConsentDocumentVersion.publish_status == "published",
            ConsentDocumentVersion.deleted == 0,
            or_(ConsentDocumentVersion.effective_time.is_(None), ConsentDocumentVersion.effective_time <= now),
            or_(ConsentDocumentVersion.expire_time.is_(None), ConsentDocumentVersion.expire_time > now),
        )
        .order_by(ConsentDocumentVersion.effective_time.desc().nullslast(), ConsentDocumentVersion.id.desc())
        .limit(1)
    )
    if version is None or not version.full_text.strip():
        raise AppError(ErrorCode.ERR_COMMON_003, "门诊评估知情同意文书未发布或内容为空", 409)
    db.add(ConsentRecord(
        task_id=task.id,
        patient_id=task.patient_id,
        encounter_id=task.encounter_id,
        consent_document_id=version.consent_document_id,
        consent_version_id=version.id,
        participant_type="patient",
        record_status="进行中",
        started_at=now,
        creator="outpatient_assessment",
        updator="outpatient_assessment",
    ))


def _status(record: ConsentRecord) -> AssessmentConsentStatus:
    if record.record_status == "已拒绝":
        return "declined"
    if record.record_status == "已完成" and record.patient_confirmed:
        return "agreed"
    return "pending"


def _records():
    return (
        select(ConsentRecord)
        .join(ConsentDocument)
        .where(
            ConsentDocument.consent_type == OUTPATIENT_CONSENT_TYPE,
            ConsentRecord.deleted == 0,
        )
    )


def task_consent_status(db: Session, task_id: int) -> AssessmentConsentStatus | None:
    record = db.scalar(_records().where(ConsentRecord.task_id == task_id))
    return _status(record) if record is not None else None


def _patient_record(
    db: Session, task_ref: str, patient_id: int, encounter_id: int, *, for_update: bool = False,
) -> ConsentRecord | None:
    conditions = [CareTask.task_no == task_ref]
    if task_ref.isdigit():
        conditions.append(CareTask.id == int(task_ref))
    query = _records().join(CareTask, CareTask.id == ConsentRecord.task_id).where(
        or_(*conditions),
        CareTask.patient_id == patient_id,
        CareTask.encounter_id == encounter_id,
        CareTask.deleted == 0,
        CareTask.task_status != "cancelled",
        ConsentRecord.patient_id == patient_id,
        ConsentRecord.encounter_id == encounter_id,
    )
    return db.scalar(query.with_for_update(of=ConsentRecord) if for_update else query)


def require_assessment_consent(
    db: Session, task_ref: str, patient: Patient, encounter: PatientEncounter,
) -> None:
    """未同意时阻止患者访问问卷。历史上未绑定文书的任务沿用原入口。"""
    if encounter.encounter_status != OUTPATIENT_ACTIVE:
        return
    record = _patient_record(db, task_ref, patient.id, encounter.id)
    if record is not None and _status(record) != "agreed":
        raise AppError(ErrorCode.ERR_COMMON_002, "当前任务需要同意门诊评估后才能填写问卷", 403)


def patient_assessment_consent(
    db: Session, task_ref: str, patient: Patient, encounter: PatientEncounter,
    decision: AssessmentConsentDecision | None = None,
) -> AssessmentConsentDto:
    if decision is not None:
        current_status = db.scalar(
            select(PatientEncounter.encounter_status)
            .where(PatientEncounter.id == encounter.id, PatientEncounter.deleted == 0)
            .with_for_update()
        )
        if current_status != OUTPATIENT_ACTIVE:
            raise AppError(ErrorCode.ERR_PATIENT_009, "本次门诊评估已结束", 401)
    record = _patient_record(db, task_ref, patient.id, encounter.id, for_update=decision is not None)
    if record is None:
        raise AppError(ErrorCode.ERR_TASK_003, "当前就诊没有可访问的评估同意记录")
    document = db.get(ConsentDocument, record.consent_document_id)
    version = db.get(ConsentDocumentVersion, record.consent_version_id)
    if decision is not None:
        if decision.record_id != record.id or decision.version != version.version_code:
            raise AppError(ErrorCode.ERR_COMMON_003, "文书版本不匹配，请重新读取", 409)
        target = "agreed" if decision.decision == "agree" else "declined"
        previous = _status(record)
        if previous == "pending":
            record.patient_confirmed = target == "agreed"
            record.record_status = "已完成" if record.patient_confirmed else "已拒绝"
            record.completed_at = datetime.now(UTC)
            record.updator = f"patient:{patient.id}"
            db.commit()
        elif previous != target:
            raise AppError(ErrorCode.ERR_COMMON_003, "已记录本次决定，请联系职工处理", 409)
    return AssessmentConsentDto(
        record_id=record.id,
        title=document.consent_name,
        version=version.version_code,
        full_text=version.full_text,
        status=_status(record),
        decided_at=record.completed_at.astimezone(UTC) if record.completed_at else None,
    )

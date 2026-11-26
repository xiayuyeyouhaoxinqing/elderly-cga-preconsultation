"""门诊评估家属协助授权、替换与撤销。

作用：在本人已同意门诊评估后，记录本次就诊允许谁协助回答、可以协助哪些
采集范围，并把认知、谵妄和现场操作类项目固定在“必须本人或专业人员完成”。
"""

from datetime import UTC, datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.errors.codes import ErrorCode
from app.errors.handlers import AppError
from app.models.patient_assistance import PatientAssistanceAuthorization
from app.models.patient_portal import ConsentDocument, ConsentRecord
from app.models.patient_task import CareTask, PatientEncounter
from app.schemas.assistance_authorization import (
    RELATION_OPTIONS,
    AssistanceAuthorizationDto,
    AssistanceAuthorizationRequest,
    AssistanceAuthorizationRevokeRequest,
    AssistanceScopeOption,
)
from app.schemas.patient import OUTPATIENT_ACTIVE
from app.services import assessment_consent_service

# 允许家属或照护者代为回忆、但必须由本人或职工复核的范围。
ASSIST_SCOPE_OPTIONS = (
    ("history", "病史、主诉补充与就诊经过"),
    ("medication", "用药、过敏及药盒等来源核对"),
    ("care_need", "照护安排、居住与家庭支持"),
    ("adl", "B.1 基本日常生活活动能力（近况回忆）"),
    ("iadl", "B.2 工具性日常生活活动能力"),
    ("environment", "B.9 居家环境筛查"),
    ("sensory", "B.4 至 B.7 视力听力陈述与助听设备情况"),
    ("continence", "B.11 尿失禁问卷简表"),
    ("sleep", "B.13 阿森斯失眠量表"),
    ("nutrition", "B.18 与 B.19 营养风险及微营养评定"),
    ("pain_self", "B.14 慢性疼痛数字评分（本人自评，他人仅可代为读出问题）"),
)

# 即使已授权也不得由协助人代答的项目：认知、谵妄与现场操作/他评。
NON_ASSISTABLE_OPTIONS = (
    ("cognitive", "B.8 简易智力评估与画钟：必须本人现场完成"),
    ("delirium", "B.21 谵妄意识模糊评估：由医务人员观察判断"),
    ("performance", "B.3 简易体能状况：平衡、4 米步速、5 次起坐等现场测试"),
    ("professional", "B.12、B.15、B.16、B.17、B.20：需专业观察或现场操作"),
)

_SCOPE_LABELS = dict(ASSIST_SCOPE_OPTIONS)


def _scope_options() -> list[AssistanceScopeOption]:
    return [AssistanceScopeOption(code=code, label=label) for code, label in ASSIST_SCOPE_OPTIONS]


def _non_assistable_options() -> list[AssistanceScopeOption]:
    return [AssistanceScopeOption(code=code, label=label) for code, label in NON_ASSISTABLE_OPTIONS]


def _mask_phone(value: str | None) -> str | None:
    """联系方式只保留末四位，全文不落库。"""
    if not value:
        return None
    if len(value) <= 4:
        return "*" * len(value)
    return "*" * (len(value) - 4) + value[-4:]


def _blank_dto() -> AssistanceAuthorizationDto:
    return AssistanceAuthorizationDto(
        status="none",
        scope_options=_scope_options(),
        relation_options=list(RELATION_OPTIONS),
        non_assistable=_non_assistable_options(),
    )


def _to_dto(record: PatientAssistanceAuthorization) -> AssistanceAuthorizationDto:
    return AssistanceAuthorizationDto(
        status="active" if record.status == "active" else "revoked",
        helper_name=record.helper_name,
        helper_relation=record.helper_relation,
        helper_contact_masked=record.helper_contact_masked,
        scope=list(record.assist_scope or []),
        authorized_at=record.authorized_at,
        revoked_at=record.revoked_at,
        revoke_reason=record.revoke_reason,
        scope_options=_scope_options(),
        relation_options=list(RELATION_OPTIONS),
        non_assistable=_non_assistable_options(),
    )


def _resolve_task(db: Session, task_ref: str) -> CareTask:
    conditions = [CareTask.task_no == task_ref]
    if task_ref.isdigit():
        conditions.append(CareTask.id == int(task_ref))
    task = db.scalar(select(CareTask).where(or_(*conditions), CareTask.deleted == 0))
    if task is None:
        raise AppError(ErrorCode.ERR_TASK_003)
    return task


def _assert_access(
    task: CareTask,
    *,
    patient_id: int | None = None,
    encounter_id: int | None = None,
    staff_id: int | None = None,
) -> None:
    """患者只能访问本人本次就诊的任务，职工只访问本人负责的任务。"""
    if patient_id is not None and (
        task.patient_id != patient_id or task.encounter_id != encounter_id
    ):
        raise AppError(ErrorCode.ERR_COMMON_002, "当前患者无权访问该任务", 403)
    if staff_id is not None and (
        task.assigned_nurse_id is not None and task.assigned_nurse_id != staff_id
    ):
        raise AppError(ErrorCode.ERR_COMMON_002, "当前任务不属于登录医护人员", 403)


def _active_record(
    db: Session,
    encounter_id: int,
    *,
    for_update: bool = False,
) -> PatientAssistanceAuthorization | None:
    query = (
        select(PatientAssistanceAuthorization)
        .where(
            PatientAssistanceAuthorization.encounter_id == encounter_id,
            PatientAssistanceAuthorization.status == "active",
            PatientAssistanceAuthorization.deleted == 0,
        )
        .order_by(PatientAssistanceAuthorization.id.desc())
        .limit(1)
    )
    if for_update:
        query = query.with_for_update()
    return db.scalar(query)


def _latest_record(db: Session, encounter_id: int) -> PatientAssistanceAuthorization | None:
    return db.scalar(
        select(PatientAssistanceAuthorization)
        .where(
            PatientAssistanceAuthorization.encounter_id == encounter_id,
            PatientAssistanceAuthorization.deleted == 0,
        )
        .order_by(PatientAssistanceAuthorization.id.desc())
        .limit(1)
    )


def _consent_record_id(db: Session, task_id: int) -> int | None:
    return db.scalar(
        select(ConsentRecord.id)
        .join(ConsentDocument, ConsentDocument.id == ConsentRecord.consent_document_id)
        .where(
            ConsentDocument.consent_type == assessment_consent_service.OUTPATIENT_CONSENT_TYPE,
            ConsentRecord.task_id == task_id,
            ConsentRecord.deleted == 0,
        )
        .order_by(ConsentRecord.id.desc())
        .limit(1)
    )


def authorization_summary(
    db: Session,
    encounter_id: int,
) -> tuple[str, str | None, list[str]]:
    """任务详情使用的授权摘要；已撤销只保留状态。"""
    record = _latest_record(db, encounter_id)
    if record is None:
        return "none", None, []
    if record.status != "active":
        return "revoked", None, []
    return "active", record.helper_name, list(record.assist_scope or [])


def get_authorization(
    db: Session,
    task_ref: str,
    *,
    patient_id: int | None = None,
    encounter_id: int | None = None,
    staff_id: int | None = None,
) -> AssistanceAuthorizationDto:
    """读取当前就诊最近一次授权；没有记录时返回 none 快照和可选范围。"""
    task = _resolve_task(db, task_ref)
    _assert_access(task, patient_id=patient_id, encounter_id=encounter_id, staff_id=staff_id)
    record = _latest_record(db, task.encounter_id)
    return _to_dto(record) if record is not None else _blank_dto()


def authorize_assistance(
    db: Session,
    task_ref: str,
    request: AssistanceAuthorizationRequest,
    *,
    patient_id: int,
    encounter_id: int,
    encounter_status: str,
) -> AssistanceAuthorizationDto:
    """本人同意后授权协助人；已有生效授权时先撤销再登记新记录。"""
    task = _resolve_task(db, task_ref)
    _assert_access(task, patient_id=patient_id, encounter_id=encounter_id)
    if encounter_status != OUTPATIENT_ACTIVE:
        raise AppError(ErrorCode.ERR_PATIENT_009, "本次门诊评估已结束", 401)
    consent_status = assessment_consent_service.task_consent_status(db, task.id)
    if consent_status != "agreed":
        raise AppError(
            ErrorCode.ERR_COMMON_002,
            "请先同意门诊评估知情同意，再授权协助人",
            403,
        )

    now = datetime.now(UTC)
    scope: list[str] = []
    for code in request.scope:
        if code not in _SCOPE_LABELS:
            raise AppError(ErrorCode.ERR_COMMON_001, f"不支持协助范围: {code}", 422)
        if code not in scope:
            scope.append(code)

    try:
        # 锁住本次就诊行，避免并发授权在“尚无生效记录”时插入两条 active。
        db.execute(
            select(PatientEncounter.id).where(PatientEncounter.id == encounter_id).with_for_update()
        )
        active = _active_record(db, encounter_id, for_update=True)
        if active is not None:
            active.status = "revoked"
            active.revoked_at = now
            active.revoke_reason = "本人更换协助人"
            active.updator = f"patient:{patient_id}"
            db.flush()
        record = PatientAssistanceAuthorization(
            patient_id=patient_id,
            encounter_id=encounter_id,
            consent_record_id=_consent_record_id(db, task.id),
            helper_name=request.helper_name,
            helper_relation=request.helper_relation,
            helper_contact_masked=_mask_phone(request.helper_phone),
            assist_scope=scope,
            status="active",
            authorized_at=now,
            recorded_by=f"patient:{patient_id}",
            creator=f"patient:{patient_id}",
            updator=f"patient:{patient_id}",
        )
        db.add(record)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _to_dto(record)


def revoke_assistance(
    db: Session,
    task_ref: str,
    request: AssistanceAuthorizationRevokeRequest,
    *,
    patient_id: int | None = None,
    encounter_id: int | None = None,
    staff_id: int | None = None,
) -> AssistanceAuthorizationDto:
    """撤销当前生效授权，保留撤销人和原因。"""
    task = _resolve_task(db, task_ref)
    _assert_access(task, patient_id=patient_id, encounter_id=encounter_id, staff_id=staff_id)
    actor = f"patient:{patient_id}" if patient_id is not None else f"staff:{staff_id}"
    try:
        active = _active_record(db, task.encounter_id, for_update=True)
        if active is None:
            raise AppError(ErrorCode.ERR_COMMON_003, "当前就诊没有生效中的协助授权", 409)
        active.status = "revoked"
        active.revoked_at = datetime.now(UTC)
        active.revoke_reason = request.reason or "本人撤销授权"
        active.updator = actor
        db.commit()
    except AppError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    return _to_dto(active)

'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NurseLayout from '@/components/layout/NurseLayout';
import { Card } from '@/components/shared/Card';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { IntegrationStatus } from '@/components/shared/IntegrationStatus';
import { abortRequest, isRequestCancelled } from '@/lib/api/httpClient';
import { mockScales } from '@/lib/mock/data';
import { careRepository } from '@/lib/repositories';
import { runtimeConfig } from '@/lib/runtime/config';
import { useTaskStore } from '@/lib/stores/useTaskStore';
import { useUserStore } from '@/lib/stores/useUserStore';
import type { PatientWithEncounter } from '@/lib/repositories/types';
import type {
  AssessmentScene,
  AssessmentScale,
  CollectionMode,
  ParticipantType,
} from '@/lib/types';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';

export default function CreateTaskPage() {
  return (
    <Suspense fallback={<NurseLayout><p>正在加载任务创建...</p></NurseLayout>}>
      <CreateTaskContent />
    </Suspense>
  );
}

function CreateTaskContent() {
  const apiMode = runtimeConfig.dataMode === 'api';
  const router = useRouter();
  const searchParams = useSearchParams();
  const addTask = useTaskStore((state) => state.addTask);
  const tasks = useTaskStore((state) => state.tasks);
  const user = useUserStore((state) => state.user);
  const [step, setStep] = useState(1);
  const requestedEncounterId = searchParams.get('encounterId');
  const requestedPatientId = searchParams.get('patientId');
  const [selectedEncounterId, setSelectedEncounterId] = useState<string>();
  const [participantType, setParticipantType] = useState<ParticipantType>('patient');
  const [relationship, setRelationship] = useState('女儿');
  const [scene, setScene] = useState<AssessmentScene>('admission');
  const [selectedScaleIds, setSelectedScaleIds] = useState<string[]>(
    apiMode ? [] : ['1', '2', '3', '4', '5']
  );
  const [collectionMode, setCollectionMode] = useState<CollectionMode>('ai_dialogue');
  const [consentRequired, setConsentRequired] = useState(!apiMode);
  const [educationTopics, setEducationTopics] = useState<string[]>(
    apiMode ? [] : ['药物过敏安全宣教', '防跌倒宣教']
  );
  const [plannedStartTime, setPlannedStartTime] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [dataNotice, setDataNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [patientRecords, setPatientRecords] = useState<PatientWithEncounter[]>([]);
  const [scales, setScales] = useState<AssessmentScale[]>(
    apiMode ? [] : mockScales
  );

  useEffect(() => {
    if (user?.role !== 'nurse') return;
    const controller = new AbortController();
    void Promise.all([
      careRepository.listInHospitalPatients(controller.signal),
      careRepository.listPatients({ status: '门诊评估中' }, controller.signal),
      apiMode ? careRepository.listScales(controller.signal) : Promise.resolve(mockScales),
    ])
      .then(([inpatients, outpatients, scaleRecords]) => {
        if (controller.signal.aborted) return;
        const records = [...inpatients, ...outpatients];
        const requested = requestedEncounterId
          ? records.find((item) => item.encounter.id === requestedEncounterId)
          : records.find((item) => item.patient.id === requestedPatientId) ?? records[0];
        setPatientRecords(records);
        setScales(scaleRecords);
        setSelectedScaleIds((current) => {
          if (requested?.encounter.encounterStatus === 'outpatient_active') return [];
          const available = new Set(scaleRecords.map((scale) => scale.id));
          const retained = current.filter((id) => available.has(id));
          return retained.length
            ? retained
            : scaleRecords.map((scale) => scale.id);
        });
        setSelectedEncounterId(requested?.encounter.id);
        if (requestedEncounterId && !requested) {
          setDataNotice('链接中的就诊已无法创建任务，可选择其他有效就诊。');
        } else {
          setDataNotice(records.length ? '' : '当前没有在院或评估中的门诊就诊。');
        }
      })
      .catch((loadError) => {
        if (controller.signal.aborted || isRequestCancelled(loadError)) return;
        setPatientRecords([]);
        setScales([]);
        setDataNotice(
          loadError instanceof Error ? loadError.message : '就诊或量表加载失败'
        );
      });
    return () => abortRequest(controller);
  }, [apiMode, requestedEncounterId, requestedPatientId, user?.role]);

  const chosen = patientRecords.find((item) => item.encounter.id === selectedEncounterId);
  const patient = chosen?.patient;
  const encounter = chosen?.encounter;
  const outpatient = encounter?.encounterStatus === 'outpatient_active';
  const taskScene = outpatient ? 'outpatient' : scene;
  const taskCollectionMode = outpatient ? 'traditional_form' : collectionMode;
  const taskParticipantType = outpatient ? 'patient' : participantType;
  const selectedScales = useMemo(
    () => scales.filter((scale) => selectedScaleIds.includes(scale.id)),
    [scales, selectedScaleIds]
  );

  const next = () => {
    if (step === 1 && !chosen) {
      setError('请选择本次就诊');
      return;
    }
    if (step === 2 && selectedScales.length === 0) {
      setError('请至少选择一张量表');
      return;
    }
    setError('');
    setStep((value) => Math.min(value + 1, 4));
  };

  const createTask = async () => {
    if (!patient || !encounter || loading) {
      if (!loading) setError('请选择本次就诊');
      return;
    }
    const duplicate = tasks.some(
      (task) =>
        task.encounterId === encounter.id &&
        (outpatient || task.assessmentScene === taskScene) &&
        task.taskStatus !== 'completed' &&
        task.taskStatus !== 'cancelled'
    );
    if (duplicate) {
      setError('本次就诊已有相同场景的未完成任务，请先查看现有任务');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const task = await careRepository.createTask({
        patient,
        encounter,
        nurseId: user?.id ?? 'N001',
        nurseName: user?.name ?? '张护士',
        scaleIds: selectedScales.map((scale) => scale.id),
        scaleNames: selectedScales.map((scale) => scale.scaleName),
        collectionMode: taskCollectionMode,
        participantType: taskParticipantType,
        participantName:
          taskParticipantType === 'patient'
            ? patient.name
            : `${patient.name}家属`,
        relationshipToPatient:
          taskParticipantType === 'patient' ? undefined : relationship,
        assessmentScene: taskScene,
        consentRequired: !apiMode && !outpatient && consentRequired,
        educationTopics: apiMode || outpatient ? [] : educationTopics,
        plannedStartTime: plannedStartTime || undefined,
        notes,
      });
      addTask(task);
      router.push(`/nurse/tasks/${task.id}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : '任务创建失败，请重试'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <NurseLayout>
      <button onClick={() => router.back()} className="flex items-center gap-2 text-foreground-muted mb-5">
        <ArrowLeftIcon className="w-5 h-5" />
        返回
      </button>

      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <Badge variant="primary">步骤 {step}/4</Badge>
            <IntegrationStatus compact />
          </div>
          <h1 className="text-3xl mt-2">创建<span className="text-primary italic">评估任务包</span></h1>
          <p className="text-foreground-muted mt-1">选择本次就诊、量表和采集方式</p>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {['患者与参与人', '选择量表', '执行配置', '发布确认'].map((label, index) => (
            <div
              key={label}
              className={`rounded-xl px-3 py-3 text-center text-xs md:text-sm ${
                step === index + 1
                  ? 'bg-primary text-white'
                  : step > index + 1
                    ? 'bg-primary-tint text-primary'
                    : 'bg-surface-secondary text-foreground-muted'
              }`}
            >
              {label}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Card padding="lg">
            <h2 className="text-xl mb-4">选择患者及本次就诊</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {patientRecords.map(({ patient: item, encounter: currentEncounter }) => {
                const isOutpatient = currentEncounter.encounterStatus === 'outpatient_active';
                return (
                  <button
                    key={currentEncounter.id}
                    type="button"
                    aria-pressed={selectedEncounterId === currentEncounter.id}
                    onClick={() => {
                      if (isOutpatient && selectedEncounterId !== currentEncounter.id) setSelectedScaleIds([]);
                      setSelectedEncounterId(currentEncounter.id);
                      setError('');
                    }}
                    className={`rounded-2xl border-2 p-4 text-left ${
                      selectedEncounterId === currentEncounter.id ? 'border-primary bg-primary-tint' : 'border-border'
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-semibold">{item.name}</span>
                      <span className="text-sm">{isOutpatient ? '门诊评估' : '住院'}</span>
                    </div>
                    <p className="text-sm text-foreground-muted mt-1">
                      {[currentEncounter.department, currentEncounter.bedNo,
                        currentEncounter.inpatientNo || currentEncounter.encounterNo].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                );
              })}
            </div>

            {outpatient ? <p className="mt-6">本次门诊评估由患者本人填写传统问卷。</p> : <div className="mt-6">
              <h3 className="font-medium mb-3">本次参与人</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { value: 'patient', label: '患者本人' },
                  { value: 'family', label: '家属' },
                  { value: 'agent', label: '授权代理人' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setParticipantType(item.value as ParticipantType)}
                    className={`rounded-xl border p-3 ${
                      participantType === item.value ? 'border-primary bg-primary-tint text-primary' : 'border-border'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {participantType !== 'patient' && (
                <div className="mt-3 max-w-sm">
                  <Input label="与患者关系" value={relationship} onChange={(event) => setRelationship(event.target.value)} />
                </div>
              )}
            </div>}
          </Card>
        )}

        {step === 2 && (
          <Card padding="lg">
            <h2 className="text-xl mb-4">选择评估量表</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {scales.map((scale) => {
                const selected = selectedScaleIds.includes(scale.id);
                return (
                  <button
                    key={scale.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setSelectedScaleIds((current) =>
                        selected
                          ? current.filter((id) => id !== scale.id)
                          : [...current, scale.id]
                      )
                    }
                    className={`rounded-2xl border-2 p-4 text-left ${
                      selected ? 'border-primary bg-primary-tint' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{scale.scaleName}</span>
                      {selected && <CheckCircleIcon className="w-5 h-5 text-primary" />}
                    </div>
                    <p className="text-sm text-foreground-muted mt-2">{scale.description}</p>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Card padding="lg">
              <h2 className="text-xl mb-4">执行方式</h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    value: 'ai_dialogue',
                    label: 'AI对话采集',
                    detail: apiMode
                      ? '文字问诊、实时抽取与护理监控'
                      : '文字/语音模拟、实时抽取与宣教',
                  },
                  { value: 'traditional_form', label: '传统问卷', detail: '分组填写、自动保存与断点续答' },
                ].filter((item) => !outpatient || item.value === 'traditional_form').map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCollectionMode(item.value as CollectionMode)}
                    className={`rounded-2xl border-2 p-4 text-left ${
                      taskCollectionMode === item.value ? 'border-primary bg-primary-tint' : 'border-border'
                    }`}
                  >
                    <p className="font-semibold">{item.label}</p>
                    <p className="text-sm text-foreground-muted mt-1">{item.detail}</p>
                  </button>
                ))}
              </div>
            </Card>

            <Card padding="lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium mb-2">评估场景</label>
                  {outpatient ? <p className="px-1 py-3">门诊评估</p> : <select
                    value={scene}
                    onChange={(event) => setScene(event.target.value as AssessmentScene)}
                    className="w-full rounded-xl border border-border bg-surface px-4 py-3"
                  >
                    <option value="admission">入院评估</option>
                    <option value="reassessment">复评</option>
                    <option value="transfer">转科评估</option>
                    <option value="discharge">出院评估</option>
                  </select>}
                </div>
                <Input
                  label="计划开始时间"
                  type="datetime-local"
                  value={plannedStartTime}
                  onChange={(event) => setPlannedStartTime(event.target.value)}
                />
              </div>

              {!apiMode && !outpatient && (
                <>
              <label className="mt-5 flex items-center gap-3 rounded-xl bg-surface-secondary p-4">
                <input
                  type="checkbox"
                  checked={consentRequired}
                  onChange={(event) => setConsentRequired(event.target.checked)}
                  className="w-5 h-5 accent-primary"
                />
                <span>
                  <span className="font-medium block">包含入院须知与知情同意</span>
                  <span className="text-xs text-foreground-muted">患者需逐条确认并完成演示手写签名</span>
                </span>
              </label>

              <div className="mt-5">
                <p className="text-sm font-medium mb-2">配套宣教</p>
                <div className="flex flex-wrap gap-2">
                  {['药物过敏安全宣教', '防跌倒宣教', '住院禁烟宣教', '用药安全宣教'].map((topic) => {
                    const selected = educationTopics.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        onClick={() =>
                          setEducationTopics((current) =>
                            selected ? current.filter((item) => item !== topic) : [...current, topic]
                          )
                        }
                        className={`rounded-full border px-4 py-2 text-sm ${
                          selected ? 'border-primary bg-primary-tint text-primary' : 'border-border'
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>
                </>
              )}

              {apiMode && (
                <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  {taskCollectionMode === 'traditional_form'
                    ? '传统问卷将按已发布量表逐组填写，答案自动保存并提交后等待护士复核。'
                    : 'AI 对话任务会先完成首问准备，患者端只会看到准备完成后的任务。'}
                </div>
              )}

              <div className="mt-5">
                <label className="block text-sm font-medium mb-2">护士备注</label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-border bg-surface p-3"
                  placeholder="例如：听力下降，请放慢语速"
                />
              </div>
            </Card>
          </div>
        )}

        {step === 4 && patient && encounter && (
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-5">
              <ClipboardDocumentCheckIcon className="w-7 h-7 text-primary" />
              <h2 className="text-2xl">发布前确认</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl bg-surface-secondary p-4">
                <p className="text-foreground-muted">患者与参与人</p>
                <p className="font-medium mt-1">{patient.name} · {taskParticipantType === 'patient' ? '患者本人' : `${relationship}协助`}</p>
              </div>
              <div className="rounded-xl bg-surface-secondary p-4">
                <p className="text-foreground-muted">{outpatient ? '门诊信息' : '住院信息'}</p>
                <p className="font-medium mt-1">{outpatient
                  ? `${encounter.department} · ${encounter.encounterNo}`
                  : `${encounter.ward} · ${encounter.bedNo} · ${encounter.inpatientNo}`}</p>
              </div>
              <div className="rounded-xl bg-surface-secondary p-4">
                <p className="text-foreground-muted">采集方式</p>
                <p className="font-medium mt-1">{taskCollectionMode === 'ai_dialogue' ? 'AI对话采集' : '传统问卷'}</p>
              </div>
              <div className="rounded-xl bg-surface-secondary p-4">
                <p className="text-foreground-muted">负责护士</p>
                <p className="font-medium mt-1">{user?.name ?? '张护士'}</p>
              </div>
            </div>
            <div className="mt-5">
              <p className="text-sm text-foreground-muted mb-2">量表任务</p>
              <div className="flex flex-wrap gap-2">
                {selectedScales.map((scale) => <Badge key={scale.id}>{scale.scaleName}</Badge>)}
              </div>
            </div>
            {!outpatient && <div className="mt-5">
              <p className="text-sm text-foreground-muted mb-2">宣教与知情同意</p>
              <p className="text-sm">
                {consentRequired ? '包含入院须知签名；' : '不包含知情同意；'}
                {educationTopics.length ? educationTopics.join('、') : '无额外宣教'}
              </p>
            </div>}
          </Card>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {dataNotice && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {dataNotice}
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="outline" disabled={step === 1} onClick={() => setStep((value) => Math.max(1, value - 1))}>
            <ArrowLeftIcon className="w-4 h-4 mr-1" />
            上一步
          </Button>
          {step < 4 ? (
            <Button disabled={step === 1 && !chosen} onClick={next}>
              下一步
              <ArrowRightIcon className="w-4 h-4 ml-1" />
            </Button>
          ) : (
            <Button loading={loading} onClick={createTask}>
              发布任务
            </Button>
          )}
        </div>
      </div>
    </NurseLayout>
  );
}

'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import PatientLayout from '@/components/layout/PatientLayout';
import Link from 'next/link';
import { Button } from '@/components/shared/Button';
import { careRepository } from '@/lib/repositories';
import { runtimeConfig } from '@/lib/runtime/config';
import { useTaskStore } from '@/lib/stores/useTaskStore';
import { useUserStore } from '@/lib/stores/useUserStore';
import { mockPatients } from '@/lib/mock/data';
import { patientDemoAccounts } from '@/lib/patient/demoAccounts';

export default function PatientVerifyPage() {
  return (
    <Suspense fallback={<VerifyFallback />}>
      <PatientVerifyContent />
    </Suspense>
  );
}

function VerifyFallback() {
  return (
    <PatientLayout>
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center">
          <Image
            src="/assets/patient/states/loading.svg"
            alt=""
            width={80}
            height={80}
            className="mx-auto h-20 w-20"
          />
          <p className="mt-4 font-medium text-foreground-muted">
            正在加载身份核验…
          </p>
        </div>
      </div>
    </PatientLayout>
  );
}

function PatientVerifyContent() {
  const apiMode = runtimeConfig.dataMode === 'api';
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tasks, setTasks, updateTask } = useTaskStore();
  const { login } = useUserStore();
  const [taskNo, setTaskNo] = useState(() => searchParams.get('taskNo') ?? '');
  const [idCardNo, setIdCardNo] = useState('');
  const [phone, setPhone] = useState('');
  const [encounterKind, setEncounterKind] = useState<'inpatient' | 'outpatient'>('outpatient');
  const [participantType, setParticipantType] = useState<'patient' | 'family'>('patient');
  const [relationship, setRelationship] = useState('女儿');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanToken, setScanToken] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const fillDemo = (mode: 'ai' | 'form') => {
    const task = tasks.find((item) =>
      mode === 'ai'
        ? item.collectionMode === 'ai_dialogue'
        : item.collectionMode === 'traditional_form'
    );
    if (!task) return;
    const patient = mockPatients.find((item) => item.id === task.patientId);
    setTaskNo(task.taskNo);
    setIdCardNo(patient?.idCard ?? '');
    setError('');
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    if (apiMode) {
      try {
        const portal = await careRepository.loginPatient({
          idCardNo: idCardNo.trim(),
          phone: phone.trim(),
          encounterKind,
        });
        setTasks(portal.tasks);
        login({
          id: portal.patient.id,
          role: 'patient',
          name: portal.patient.name,
          department: portal.encounter.department,
        });
        router.push('/patient/tasks');
      } catch (loginError) {
        setError(
          loginError instanceof Error
            ? loginError.message
            : '患者身份核验失败'
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 450));

    const task = tasks.find((item) => item.taskNo.toLowerCase() === taskNo.trim().toLowerCase());
    const patient = task
      ? mockPatients.find((item) => item.id === task.patientId)
      : undefined;

    if (!task || !patient) {
      setError('没有找到该任务，请检查任务编号');
      setLoading(false);
      return;
    }

    if (patient.idCard !== idCardNo.trim()) {
      setError('证件后四位与任务患者不匹配');
      setLoading(false);
      return;
    }

    updateTask(task.id, {
      participantType,
      participantName: participantType === 'patient' ? patient.name : `${patient.name}家属`,
      relationshipToPatient: participantType === 'family' ? relationship : undefined,
    });
    login({
      id: patient.id,
      role: 'patient',
      name: patient.name,
      department: task.department,
    });
    router.push('/patient/tasks');
  };

  const handleScanVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!scanToken.trim()) return;
    setError('');
    setLoading(true);
    try {
      const portal = await careRepository.verifyPatientScanToken(scanToken.trim());
      setTasks(portal.tasks);
      login({
        id: portal.patient.id,
        role: 'patient',
        name: portal.patient.name,
        department: portal.encounter.department,
      });
      router.push('/patient/tasks');
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : '扫码核验失败，请重新扫码'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="cga-screen min-h-dvh px-5 py-6 sm:py-10">
      <div className="cga-interaction mx-auto max-w-lg md:max-w-xl">
        <Link href="/" className="inline-flex min-h-11 items-center text-primary-hover underline underline-offset-4">返回身份选择</Link>
        <header className="mt-4 mb-6 border-l-4 border-primary pl-4">
          <p className="text-foreground-muted">患者服务</p>
          <h1 className="mt-1 text-3xl font-semibold">患者身份核验</h1>
          <p className="mt-2 text-lg text-foreground-muted">
            {apiMode ? '请填写就诊登记信息，核验后查看本人任务。' : '这是演示环境。可以填入示例任务，体验患者流程。'}
          </p>
        </header>
        <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
          {searchParams.get('session') === 'expired' && (
            <p role="status" className="mb-4 rounded-lg bg-surface-secondary px-4 py-3 text-foreground">
              患者登录已失效，请重新登录。
            </p>
          )}
          <form onSubmit={handleVerify} className="space-y-5">
            {apiMode && (
              <label className="block font-medium">
                <span className="mb-2 block">就诊类型</span>
                <select className="cga-field" value={encounterKind}
                  onChange={(event) => setEncounterKind(event.target.value === 'inpatient' ? 'inpatient' : 'outpatient')}>
                  <option value="outpatient">门诊评估</option>
                  <option value="inpatient">住院评估</option>
                </select>
              </label>
            )}
            {!apiMode && (
              <fieldset>
                <legend className="mb-2 font-semibold">由谁填写</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([['patient', '患者本人'], ['family', '家属协助']] as const).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={participantType === value}
                      onClick={() => setParticipantType(value)}
                      className="min-h-12 cursor-pointer rounded-lg border border-border px-2 font-medium aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-hover">
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {!apiMode && (
              <label className="block font-medium">
                <span className="mb-2 block">任务编号</span>
                <input className="cga-field" value={taskNo} onChange={(event) => setTaskNo(event.target.value)} required />
              </label>
            )}
            <label className="block font-medium">
              <span className="mb-2 block">{apiMode ? '身份证号' : '证件号后四位'}</span>
              <input className="cga-field" value={idCardNo} onChange={(event) => setIdCardNo(event.target.value)}
                maxLength={apiMode ? 18 : 4} inputMode={apiMode ? 'text' : 'numeric'} required />
            </label>
            {apiMode && (
              <label className="block font-medium">
                <span className="mb-2 block">登记手机号</span>
                <input className="cga-field" type="tel" autoComplete="tel" value={phone}
                  onChange={(event) => setPhone(event.target.value)} maxLength={20} required />
              </label>
            )}
            {!apiMode && participantType === 'family' && (
              <label className="block font-medium">
                <span className="mb-2 block">与患者关系</span>
                <select className="cga-field" value={relationship} onChange={(event) => setRelationship(event.target.value)}>
                  <option>女儿</option><option>儿子</option><option>配偶</option><option>其他家属</option>
                </select>
              </label>
            )}
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">{error}</p>}
            <Button type="submit" loading={loading} className="min-h-13 w-full rounded-lg shadow-none hover:translate-y-0 hover:shadow-none">
              {loading ? '正在核验…' : '核验并进入'}
            </Button>
          </form>
          {!apiMode && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 font-medium">填入演示信息</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11 rounded-lg" onClick={() => fillDemo('form')}>传统问卷任务</Button>
                <Button type="button" variant="outline" className="min-h-11 rounded-lg" onClick={() => fillDemo('ai')}>AI 对话任务</Button>
              </div>
            </div>
          )}
          {apiMode && process.env.NODE_ENV === 'development' && (
            <details className="mt-5 border-t border-border pt-4">
              <summary className="min-h-11 cursor-pointer text-primary-hover">联调演示身份</summary>
              <div className="flex flex-wrap gap-2">
                {patientDemoAccounts.map((account) => (
                  <Button key={account.idCardNo} type="button" variant="outline" className="min-h-11 rounded-lg"
                    onClick={() => { setIdCardNo(account.idCardNo); setPhone(account.phone); setError(''); }}>
                    填充{account.name}
                  </Button>
                ))}
              </div>
            </details>
          )}
          <Button type="button" variant="outline" className="mt-3 min-h-11 rounded-lg"
            aria-expanded={scanOpen} onClick={() => { setScanOpen((current) => !current); setError(''); }}>
            {scanOpen ? '收起扫码核验' : '使用扫码令牌'}
          </Button>
          {scanOpen && (
            <form onSubmit={handleScanVerify} className="mt-3 space-y-3 rounded-lg bg-surface-secondary p-4">
              <label className="block font-medium">
                <span className="mb-2 block">院内一次性令牌</span>
                <input value={scanToken} onChange={(event) => setScanToken(event.target.value)} className="cga-field" minLength={24} required />
              </label>
              <p className="text-foreground-muted">请粘贴二维码中的令牌。过期后可请护士重新生成。</p>
              <Button type="submit" loading={loading} className="min-h-11 rounded-lg">{loading ? '正在核验…' : '核验扫码令牌'}</Button>
            </form>
          )}
        </section>
        <p className="mt-4 text-foreground-muted">需要帮助时，可请现场工作人员协助。</p>
      </div>
    </main>
  );
}

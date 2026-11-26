'use client';

import { useEffect, useState } from 'react';
import { careRepository } from '@/lib/repositories';
import type { AssessmentConsent } from '@/lib/types';

export function PatientAssessmentConsent({ taskId, onAgree }: {
  taskId: string;
  onAgree: () => void;
}) {
  const [consent, setConsent] = useState<AssessmentConsent>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void careRepository.getAssessmentConsent(taskId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setConsent(result);
    }).catch((failure) => {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '暂时无法读取同意文书');
      }
    });
    return () => controller.abort();
  }, [taskId, loadAttempt]);

  async function choose(decision: 'agree' | 'decline') {
    if (!consent || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await careRepository.decideAssessmentConsent(taskId, consent, decision);
      setConsent(result);
      if (result.status === 'agreed') onAgree();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法保存决定');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="patient-card space-y-4 p-4" aria-labelledby="assessment-consent-title">
      <h2 id="assessment-consent-title" className="text-xl font-semibold">
        {consent?.title || '门诊评估知情同意'}
      </h2>
      {consent ? (
        <>
          <p className="text-sm text-foreground-muted">文书版本 {consent.version}</p>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{consent.fullText}</p>
          {consent.status === 'pending' ? (
            <div className="grid gap-3">
              <button type="button" className="patient-primary-button w-full" disabled={saving}
                onClick={() => void choose('agree')}>
                同意并开始评估
              </button>
              <button type="button" className="patient-outline-button w-full" disabled={saving}
                onClick={() => void choose('decline')}>
                拒绝本次评估
              </button>
              {saving && <p role="status">正在保存决定…</p>}
            </div>
          ) : consent.status === 'agreed' ? (
            <button type="button" className="patient-primary-button w-full" onClick={onAgree}>
              开始评估
            </button>
          ) : <p role="status">已记录拒绝，本次评估暂停。需要帮助请联系职工。</p>}
        </>
      ) : !error && <p role="status">正在读取同意文书…</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {error && (
        <button type="button" className="patient-outline-button w-full" onClick={() => {
          setConsent(undefined);
          setError('');
          setLoadAttempt((attempt) => attempt + 1);
        }}>
          重新读取文书
        </button>
      )}
    </section>
  );
}

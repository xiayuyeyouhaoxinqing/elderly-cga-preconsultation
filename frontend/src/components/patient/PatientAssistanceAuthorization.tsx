'use client';

import { useEffect, useState } from 'react';
import { careRepository } from '@/lib/repositories';
import type { AssistanceAuthorization } from '@/lib/types';

const FIELD_CLASS =
  'min-h-[56px] w-full rounded-2xl border-[1.5px] border-[#efc9ae] bg-white/85 px-4 py-3 text-base outline-none focus:border-primary';

export function PatientAssistanceAuthorization({ taskId }: { taskId: string }) {
  const [authorization, setAuthorization] = useState<AssistanceAuthorization>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [helperName, setHelperName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void careRepository
      .getAssistanceAuthorization(taskId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAuthorization(result);
        if (result.status === 'none') setEditing(true);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : '暂时无法读取协助授权');
        }
      });
    return () => controller.abort();
  }, [taskId, loadAttempt]);

  function toggleScope(code: string) {
    setScope((current) =>
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code]
    );
  }

  function startEditing() {
    if (!authorization) return;
    setHelperName(authorization.helperName ?? '');
    setRelation(authorization.helperRelation ?? '');
    setPhone('');
    setScope(authorization.scope ?? []);
    setAcknowledged(false);
    setError('');
    setEditing(true);
  }

  function scopeLabel(code: string) {
    return (
      authorization?.scopeOptions.find((option) => option.code === code)?.label ?? code
    );
  }

  async function submit() {
    if (!authorization || saving) return;
    if (!helperName.trim()) {
      setError('请填写协助人姓名');
      return;
    }
    if (!relation) {
      setError('请选择协助人与您的关系');
      return;
    }
    if (scope.length === 0) {
      setError('请至少选择一项可以协助的内容');
      return;
    }
    if (!acknowledged) {
      setError('请确认您已向协助人说明协助范围');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await careRepository.authorizeAssistance(taskId, {
        helperName: helperName.trim(),
        helperRelation: relation,
        helperPhone: phone.trim() || undefined,
        scope,
      });
      setAuthorization(result);
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法保存授权');
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      setAuthorization(await careRepository.revokeAssistance(taskId));
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '暂时无法撤销授权');
    } finally {
      setSaving(false);
    }
  }

  const active = authorization?.status === 'active';
  const showForm = Boolean(authorization) && (editing || !active);

  return (
    <section
      className="patient-card space-y-4 p-4"
      aria-labelledby="assistance-authorization-title"
    >
      <header className="space-y-1">
        <h2 id="assistance-authorization-title" className="text-xl font-semibold">
          家属或照护者协助（可选）
        </h2>
        <p className="text-sm leading-relaxed text-foreground-muted">
          只有您本人同意后才能授权。协助人只能帮您补充和回忆；认知、谵妄和现场测试必须由您本人或医务人员完成。
        </p>
      </header>

      {authorization && active && !editing && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-[#eef8f5] p-3">
            <p className="text-base font-medium">
              {authorization.helperName}（{authorization.helperRelation}）正在协助本次评估
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
              可协助范围：{authorization.scope.map(scopeLabel).join('、')}
            </p>
            {authorization.helperContactMasked && (
              <p className="mt-1 text-sm text-foreground-muted">
                联系方式：{authorization.helperContactMasked}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="patient-outline-button w-full"
              disabled={saving}
              onClick={startEditing}
            >
              更换协助人
            </button>
            <button
              type="button"
              className="patient-outline-button w-full"
              disabled={saving}
              onClick={() => void revoke()}
            >
              撤销授权
            </button>
          </div>
        </div>
      )}

      {showForm && authorization && (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-base font-medium" htmlFor="assistance-helper-name">
              协助人姓名
            </label>
            <input
              id="assistance-helper-name"
              className={FIELD_CLASS}
              value={helperName}
              maxLength={32}
              onChange={(event) => setHelperName(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-base font-medium" htmlFor="assistance-helper-relation">
              与您的关系
            </label>
            <select
              id="assistance-helper-relation"
              className={FIELD_CLASS}
              value={relation}
              onChange={(event) => setRelation(event.target.value)}
            >
              <option value="">请选择</option>
              {authorization.relationOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-base font-medium" htmlFor="assistance-helper-phone">
              协助人联系方式（可不填）
            </label>
            <input
              id="assistance-helper-phone"
              className={FIELD_CLASS}
              inputMode="numeric"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
            />
            <p className="text-xs text-foreground-muted">系统只保存末四位，用于联系核对。</p>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-base font-medium">可以协助的内容</legend>
            {authorization.scopeOptions.map((option) => (
              <label
                key={option.code}
                className="flex items-start gap-3 rounded-xl border border-[#eadfd6] p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={scope.includes(option.code)}
                  onChange={() => toggleScope(option.code)}
                />
                <span className="text-sm leading-relaxed">{option.label}</span>
              </label>
            ))}
          </fieldset>

          <div className="rounded-2xl bg-[#fff6ef] p-3">
            <p className="text-sm font-medium">以下项目不能由协助人代答</p>
            <ul className="mt-2 space-y-1 text-sm leading-relaxed text-foreground-muted">
              {authorization.nonAssistable.map((option) => (
                <li key={option.code}>· {option.label}</li>
              ))}
            </ul>
          </div>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span className="text-sm leading-relaxed">
              我已告知协助人上述范围，并同意其在本次就诊中协助回答。
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {active && (
              <button
                type="button"
                className="patient-outline-button w-full"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                取消修改
              </button>
            )}
            <button
              type="button"
              className="patient-primary-button w-full"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? '正在保存…' : '保存授权'}
            </button>
          </div>
        </div>
      )}

      {!authorization && !error && <p role="status">正在读取协助授权…</p>}

      {authorization?.status === 'revoked' && !editing && (
        <p role="status" className="text-sm leading-relaxed text-foreground-muted">
          协助授权已撤销
          {authorization.revokeReason ? `（${authorization.revokeReason}）` : ''}
          ，本次评估需要您本人继续作答。
        </p>
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}

      {error && !authorization && (
        <button
          type="button"
          className="patient-outline-button w-full"
          onClick={() => {
            setError('');
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          重新读取
        </button>
      )}
    </section>
  );
}

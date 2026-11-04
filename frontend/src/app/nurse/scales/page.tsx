'use client';

import { useEffect, useState, type FormEvent } from 'react';
import NurseLayout from '@/components/layout/NurseLayout';
import { careRepository } from '@/lib/repositories';
import { isRequestCancelled } from '@/lib/api/httpClient';
import { useUserStore } from '@/lib/stores/useUserStore';
import { runtimeConfig } from '@/lib/runtime/config';
import type { AssessmentScale } from '@/lib/types';
import { Button } from '@/components/shared/Button';

const columns = ['量表名称', '编码', '类型', '版本', '非派生题目数'];

export default function PublishedScalesPage() {
  const user = useUserStore((state) => state.user);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState({ keyword: '', revision: 0 });
  const [scales, setScales] = useState<AssessmentScale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user?.role !== 'nurse') return;
    const controller = new AbortController();
    // 延至下一任务启动，清理时取消，避免卸载及旧请求覆盖新查询。
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      void careRepository.listScales(controller.signal, { keyword: query.keyword })
        .then((rows) => { if (!controller.signal.aborted) setScales(rows); })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && !isRequestCancelled(failure)) {
            setScales([]);
            setError(failure instanceof Error ? failure.message : '量表加载失败，请重试');
          }
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [user?.role, query]);

  function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setQuery((previous) => ({ keyword: input.trim(), revision: previous.revision + 1 }));
  }

  return (
    <NurseLayout>
      <div className="cga-screen rounded-xl p-4 sm:p-6">
        <header className="mb-5 border-l-4 border-primary pl-4">
          <p className="mb-1 text-foreground-muted">职工工作台 · 量表管理</p>
          <h1 className="text-3xl font-semibold">已发布量表</h1>
          <p className="mt-2 text-foreground-muted">查看当前生效的量表版本。{runtimeConfig.dataMode === 'mock' && '当前显示演示数据。'}</p>
        </header>
        {user?.role === 'nurse' && (
          <>
            <form onSubmit={search} className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
              <label className="w-full max-w-sm font-medium sm:flex-1">
                <span className="mb-2 block">量表名称</span>
                <input className="cga-field" value={input} maxLength={50}
                  onChange={(event) => setInput(event.target.value)} placeholder="例如：营养" />
              </label>
              <Button className="min-h-12 rounded-lg shadow-none hover:translate-y-0 hover:shadow-none" disabled={loading} type="submit">查询</Button>
              <Button className="min-h-12 rounded-lg" variant="outline" disabled={loading} type="button"
                onClick={() => { setInput(''); setLoading(true); setQuery((previous) => ({ keyword: '', revision: previous.revision + 1 })); }}>清空</Button>
            </form>
            <div aria-live="polite" aria-busy={loading} className="rounded-xl border border-border bg-surface">
              {loading ? <p className="p-4" role="status">正在加载…</p> : error ? <p className="p-4 text-red-800" role="alert">加载失败：{error}。请点击查询重试。</p> : scales.length === 0 ? <p className="p-4">暂无匹配的已发布量表。</p> : (
                <table role="table" className="block w-full table-fixed border-collapse text-left lg:table">
                  <caption className="block px-4 py-3 text-left font-medium lg:table-caption">共 {scales.length} 项</caption>
                  <thead role="rowgroup" className="sr-only lg:not-sr-only lg:table-header-group">
                    <tr role="row">{columns.map((title) => <th scope="col" role="columnheader" className="bg-surface-secondary p-3 text-sm first:w-[31%]" key={title}>{title}</th>)}</tr>
                  </thead>
                  <tbody role="rowgroup" className="block lg:table-row-group">
                    {scales.map((scale) => (
                      <tr role="row" key={scale.id} className="grid grid-cols-2 gap-x-3 border-t border-border px-4 py-3 lg:table-row lg:p-0">
                        {[scale.scaleName, scale.scaleCode, scale.scaleType, scale.versionCode ?? '未提供', scale.questionCount ?? '未提供'].map((value, index) => (
                          <td role="cell" key={columns[index]} className="min-w-0 py-2 break-words first:col-span-2 first:font-semibold lg:p-3">
                            {index > 0 && <span aria-hidden="true" className="block text-sm text-foreground-muted lg:hidden">{columns[index]}</span>}
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </NurseLayout>
  );
}

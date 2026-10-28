'use client';

import { useEffect, useState, type FormEvent } from 'react';
import NurseLayout from '@/components/layout/NurseLayout';
import { careRepository } from '@/lib/repositories';
import { isRequestCancelled } from '@/lib/api/httpClient';
import { useUserStore } from '@/lib/stores/useUserStore';
import { runtimeConfig } from '@/lib/runtime/config';
import type { AssessmentScale } from '@/lib/types';

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

  return <NurseLayout>
    <h1 className="text-2xl font-semibold mb-3">已发布量表</h1>
    <p className="mb-5 text-foreground-muted">只读查询当前生效的已发布量表。当前数据模式：{runtimeConfig.dataMode === 'mock' ? 'Mock演示' : 'API服务'}。</p>
    {user?.role === 'nurse' && <>
      <form onSubmit={search} className="flex flex-wrap gap-3 mb-5 items-end">
        <label className="flex flex-col gap-2">量表名称
          <input className="border rounded-lg p-3" value={input} maxLength={50}
            onChange={(event) => setInput(event.target.value)} placeholder="输入名称关键词" />
        </label>
        <button className="border rounded-lg p-3 disabled:opacity-50" disabled={loading} type="submit">查询</button>
        <button className="border rounded-lg p-3 disabled:opacity-50" disabled={loading} type="button"
          onClick={() => { setInput(''); setLoading(true); setQuery((previous) => ({ keyword: '', revision: previous.revision + 1 })); }}>清空</button>
      </form>
      <div aria-live="polite" aria-busy={loading}>
        {loading ? <p role="status">正在加载…</p> : error ? <p role="alert">加载失败：{error}。请点击查询重试。</p> : scales.length === 0 ? <p>暂无匹配的已发布量表。</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left border-collapse">
            <caption className="text-left mb-3">共 {scales.length} 项</caption>
            <thead><tr>{['量表名称', '编码', '类型', '版本', '非派生题目数'].map((title) => <th scope="col" className="border p-3" key={title}>{title}</th>)}</tr></thead>
            <tbody>{scales.map((scale) => <tr key={scale.id}>
              <td className="border p-3">{scale.scaleName}</td><td className="border p-3">{scale.scaleCode}</td>
              <td className="border p-3">{scale.scaleType}</td><td className="border p-3">{scale.versionCode ?? '未提供'}</td>
              <td className="border p-3">{scale.questionCount ?? '未提供'}</td>
            </tr>)}</tbody>
          </table></div>}
      </div>
    </>}
  </NurseLayout>;
}

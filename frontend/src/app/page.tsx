import Link from 'next/link';
import { ArrowRightIcon, ClipboardDocumentListIcon, IdentificationIcon } from '@heroicons/react/24/outline';
import { runtimeConfig } from '@/lib/runtime/config';

const entries = [
  { href: '/patient', title: '患者入口', description: '核验身份，查看和填写您的评估任务。', action: '进入患者端', icon: ClipboardDocumentListIcon },
  { href: '/nurse/login', title: '医院职工入口', description: '使用工号登录，查看评估任务及量表。', action: '进入职工端', icon: IdentificationIcon },
];

export default function Home() {
  return (
    <main className="cga-screen min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
          <ClipboardDocumentListIcon aria-hidden="true" className="size-6 text-primary" />
          <p className="font-semibold">老年综合评估</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-14">
        <div className="grid overflow-hidden rounded-2xl bg-primary-hover text-white md:grid-cols-[1.6fr_1fr]">
          <section className="p-6 sm:p-10">
            <p className="mb-3 font-medium text-[#c3e5da]">门诊服务 · 预问诊</p>
            <h1 className="max-w-[13em] text-3xl leading-tight font-semibold sm:text-5xl">老年预问诊与综合评估</h1>
            <p className="mt-4 max-w-[26em] text-lg text-[#e0f0ea]">就诊前填写评估信息，医护人员可在接诊时查看和核验。</p>
          </section>
          <section aria-label="患者评估步骤" className="border-t border-white/25 px-6 py-5 sm:px-10 md:border-t-0 md:border-l md:py-10">
            <p className="mb-3 font-medium text-[#c3e5da]">患者评估步骤</p>
            <ol className="space-y-3">
              {['核验身份', '填写评估', '医护核验'].map((label, index) => (
                <li key={label} className="flex items-center gap-3">
                  <span aria-hidden="true" className="grid size-8 place-items-center rounded-full border border-white/50 text-sm tabular-nums">{index + 1}</span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <h2 className="mt-8 mb-4 text-xl font-semibold">请选择身份</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {entries.map(({ href, title, description, action, icon: Icon }) => (
            <Link key={href} href={href} className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-5 hover:border-primary sm:p-6">
              <span className="grid size-11 place-items-center rounded-lg bg-primary-tint text-primary"><Icon aria-hidden="true" className="size-6" /></span>
              <h3 className="text-2xl font-semibold">{title}</h3>
              <p className="text-base text-foreground-muted">{description}</p>
              <span className="mt-auto inline-flex min-h-11 items-center gap-2 font-semibold text-primary-hover group-hover:underline">{action}<ArrowRightIcon aria-hidden="true" className="size-4" /></span>
            </Link>
          ))}
        </div>
        {runtimeConfig.dataMode === 'mock' && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 border-t border-border pt-2 text-foreground-muted">
            <Link className="inline-flex min-h-11 items-center font-medium text-primary-hover underline underline-offset-4" href="/patient/assessment-preview">体验评估样板</Link>
            <span>仅使用示例数据</span>
          </div>
        )}
      </div>
    </main>
  );
}

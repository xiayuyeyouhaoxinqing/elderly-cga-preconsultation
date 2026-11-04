import Link from 'next/link';
import { ArrowRightIcon, ClipboardDocumentListIcon, IdentificationIcon } from '@heroicons/react/24/outline';
import { runtimeConfig } from '@/lib/runtime/config';

export default function Home() {
  return (
    <main className="cga-screen min-h-dvh">
      <header className="bg-primary-hover text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4 sm:px-8">
          <ClipboardDocumentListIcon aria-hidden="true" className="size-6" />
          <p className="font-semibold">老年综合评估服务</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-12">
        <header className="mb-6 border-l-4 border-primary pl-4 sm:mb-8 sm:pl-6">
          <h1 className="text-[clamp(1.75rem,4vw,3.25rem)] leading-tight">老年预问诊与综合评估</h1>
          <p className="mt-3 max-w-[34em] text-lg text-foreground-muted">患者和医院职工请选择对应入口。</p>
        </header>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-5 sm:p-7">
            <ClipboardDocumentListIcon aria-hidden="true" className="size-7 text-primary" />
            <h2 className="text-2xl">患者入口</h2>
            <p className="text-lg text-foreground-muted">核验身份，查看和填写您的评估任务。</p>
            <Link href="/patient" className="cga-touch-link mt-auto inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg bg-primary px-4 font-semibold text-white hover:bg-primary-hover sm:w-auto">
              进入患者端 <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0" />
            </Link>
          </section>
          <section className="flex flex-col items-start gap-3 rounded-xl border border-border bg-surface p-5 sm:p-7">
            <IdentificationIcon aria-hidden="true" className="size-7 text-primary" />
            <h2 className="text-2xl">医院职工入口</h2>
            <p className="text-lg text-foreground-muted">使用工号登录，查看评估任务及量表。</p>
            <Link href="/nurse/login" className="cga-touch-link mt-auto inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-primary px-4 font-semibold text-primary-hover hover:bg-primary-tint sm:w-auto">
              进入职工端 <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0" />
            </Link>
          </section>
        </div>

        <section aria-labelledby="assessment-steps" className="mt-6 rounded-xl border border-border bg-surface-secondary px-5 py-4 sm:px-7">
          <h2 id="assessment-steps" className="mb-3 text-lg">患者评估步骤</h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {['核验身份', '填写评估', '医护核验'].map((label, index) => (
              <li key={label} className="flex items-center gap-3">
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-surface font-semibold text-primary-hover">{index + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </section>
        {runtimeConfig.dataMode === 'mock' && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 text-foreground-muted">
            <Link className="cga-touch-link inline-flex min-h-11 items-center font-medium text-primary-hover underline underline-offset-4" href="/patient/assessment-preview">体验评估样板</Link>
            <span>仅使用示例数据</span>
          </div>
        )}
      </div>
    </main>
  );
}

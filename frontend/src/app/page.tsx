import Link from 'next/link';
import { ArrowRightIcon, ClipboardDocumentListIcon, IdentificationIcon } from '@heroicons/react/24/outline';
import { runtimeConfig } from '@/lib/runtime/config';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
      <header className="mb-8 border-b border-border pb-6 sm:mb-10">
        <p className="mb-3 font-medium text-foreground-muted">就医前评估</p>
        <h1 className="text-3xl leading-tight font-semibold sm:text-5xl">老年预问诊与综合评估</h1>
        <p className="mt-4 text-lg text-foreground-muted">请选择您的身份，进入对应的服务。</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/patient" className="group block rounded-xl border border-border bg-surface p-6 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <ClipboardDocumentListIcon aria-hidden="true" className="mb-4 size-7 text-primary" />
          <h2 className="text-2xl font-semibold">患者入口</h2>
          <p className="mt-2 text-lg text-foreground-muted">核验身份，查看和填写您的评估任务。</p>
          <span className="mt-5 inline-flex items-center gap-2 font-medium text-primary-hover">进入患者端 <ArrowRightIcon aria-hidden="true" className="size-4" /></span>
        </Link>
        <Link href="/nurse/login" className="group block rounded-xl border border-border bg-surface p-6 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <IdentificationIcon aria-hidden="true" className="mb-4 size-7 text-primary" />
          <h2 className="text-2xl font-semibold">医院职工入口</h2>
          <p className="mt-2 text-lg text-foreground-muted">使用工号登录，查看评估任务及量表。</p>
          <span className="mt-5 inline-flex items-center gap-2 font-medium text-primary-hover">进入职工端 <ArrowRightIcon aria-hidden="true" className="size-4" /></span>
        </Link>
      </div>
      {runtimeConfig.dataMode === 'mock' && (
        <p className="mt-8 text-foreground-muted">
          <Link className="inline-flex min-h-11 items-center text-primary-hover underline underline-offset-4" href="/patient/assessment-preview">体验评估样板</Link>
          <span className="ml-3">仅使用示例数据</span>
        </p>
      )}
    </main>
  );
}

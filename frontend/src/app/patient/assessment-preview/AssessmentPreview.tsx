'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/shared/Button';

const sampleItems = [
  {
    tool: 'B.1 基本日常生活活动能力',
    question: '您吃饭时需要别人帮忙吗？',
    options: ['可以自己吃饭', '需要一些帮助', '需要很多帮助或完全依赖他人', '不确定，请评估人员确认'],
  },
  {
    tool: 'B.2 工具性日常生活活动能力',
    question: '最近一个月，您通常怎样购买生活用品？',
    options: ['能自己完成所有购物', '能自己购买日常用品', '每次购物都需要人陪伴', '完全不上街购物', '不确定，请评估人员确认'],
  },
];

export function AssessmentPreview() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [largeText, setLargeText] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const item = sampleItems[step];

  function changeStep(nextStep: number) {
    setStep(nextStep);
    stepHeading.current?.focus();
  }

  return (
    <main className="cga-screen min-h-dvh">
      <div className={`cga-interaction mx-auto w-full max-w-2xl px-5 py-6 sm:px-8 sm:py-10 ${largeText ? 'text-xl' : 'text-lg'}`}>
      <header className="mb-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center text-primary-hover underline underline-offset-4">返回首页</Link>
          <Button type="button" variant="outline" className="min-h-11 rounded-lg" aria-pressed={largeText} onClick={() => setLargeText(!largeText)}>大字模式</Button>
        </div>
        <p className="mb-1 font-medium text-primary-hover">患者服务 · 演示</p>
        <h1 className="text-3xl font-semibold">预问诊评估样板</h1>
        <p className="mt-3 text-foreground-muted">
          B.1 与 B.2 各有一道示例题。作答只在本页显示，不会上传。
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        {item && <progress aria-label="填写进度" value={step + 1} max={sampleItems.length} className="mb-4 block h-2 w-full accent-primary" />}
        <h2 ref={stepHeading} tabIndex={-1} className="mb-4 text-[1.1em] font-semibold text-primary-hover" aria-live="polite">
          {item ? `第 ${step + 1} / ${sampleItems.length} 题 · ${item.tool}` : '报告草稿预览'}
        </h2>
        {item ? (
          <form onSubmit={(event) => { event.preventDefault(); if (answers[step]) changeStep(step + 1); }}>
            <fieldset>
              <legend className="mb-4 text-[1.25em] leading-snug font-semibold">{item.question}</legend>
              <div className="space-y-3">
                {item.options.map((option) => (
                  <label key={option} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-border px-4 py-3 has-checked:border-primary has-checked:bg-primary-tint has-focus-visible:outline-2 has-focus-visible:outline-primary">
                    <input
                      type="radio"
                      name={`sample-${step}`}
                      className="size-5 shrink-0 accent-primary-hover"
                      checked={answers[step] === option}
                      onChange={() => setAnswers((previous) => Object.assign([...previous], { [step]: option }))}
                      required
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="submit" className="min-h-12 rounded-lg bg-primary-hover hover:translate-y-0">{step === 0 ? '下一题' : '查看报告草稿'}</Button>
              {step > 0 && <Button type="button" variant="outline" className="min-h-12 rounded-lg" onClick={() => changeStep(step - 1)}>上一题</Button>}
            </div>
          </form>
        ) : (
          <>
            <p className="text-foreground-muted">来源为本次演示填写，状态为待人工核验。完整评估、计分及审核功能后续接入。</p>
            <dl className="mt-4 divide-y divide-border border-y border-border">
              {sampleItems.map(({ tool }, index) => (
                <div key={tool} className="py-4">
                  <dt className="font-semibold">{tool}</dt>
                  <dd className="mt-1">{answers[index]}</dd>
                </div>
              ))}
            </dl>
            <Button type="button" variant="outline" className="mt-6 min-h-12 rounded-lg" onClick={() => changeStep(step - 1)}>返回修改</Button>
          </>
        )}
      </section>
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NetworkStatus } from '@/components/shared/NetworkStatus';
import './globals.css';

export const metadata: Metadata = {
  title: '老年预问诊与综合评估',
  description: '患者评估与医院职工工作入口',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <NetworkStatus />
        {children}
      </body>
    </html>
  );
}

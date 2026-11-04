'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/shared/Card';
import { useUserStore } from '@/lib/stores/useUserStore';
import { careRepository } from '@/lib/repositories';
import { runtimeConfig } from '@/lib/runtime/config';

export default function NurseLoginPage() {
  const router = useRouter();
  const { login } = useUserStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const user = await careRepository.loginStaff({
        staffNo: username,
        password,
      });
      login(user);
      router.push('/nurse/dashboard');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="cga-screen min-h-dvh px-5 py-8 sm:py-14">
      <div className="cga-interaction mx-auto max-w-md md:max-w-lg">
        <Link href="/" className="inline-flex min-h-11 items-center text-primary-hover underline underline-offset-4">
          返回身份选择
        </Link>
        <div className="mt-4 mb-6 border-l-4 border-primary pl-4">
          <p className="mb-2 text-foreground-muted">老年综合评估 · 职工工作台</p>
          <h1 className="text-3xl font-semibold">医院职工登录</h1>
        </div>

        <Card className="rounded-xl border-border shadow-none">
          <CardHeader>
            <CardTitle>使用职工账号</CardTitle>
            <CardDescription>请使用您的工号和密码登录</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="工号"
                className="cga-field"
                type="text"
                autoComplete="username"
                placeholder="请输入工号"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <Input
                label="密码"
                className="cga-field"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="min-h-13 w-full rounded-lg shadow-none hover:translate-y-0 hover:shadow-none" loading={loading}>
                {loading ? '正在登录' : '登录'}
              </Button>
            </form>

            {runtimeConfig.dataMode === 'mock' && (
            <div className="mt-5 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 rounded-lg"
                onClick={() => {
                  setUsername('N001');
                  setPassword('123456');
                }}
              >
                填充演示账号
              </Button>
              <p className="mt-2 text-sm text-foreground-muted">演示环境仅使用示例账号。</p>
            </div>
            )}
          </CardContent>
        </Card>

      </div>
    </main>
  );
}

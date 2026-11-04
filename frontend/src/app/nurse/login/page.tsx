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
    <main className="mx-auto w-full max-w-md px-5 py-10 sm:py-16">
        <Link href="/" className="inline-flex min-h-11 items-center text-primary-hover underline underline-offset-4">
          返回身份选择
        </Link>
        <div className="mt-6 mb-6">
          <p className="mb-2 text-foreground-muted">老年预问诊与综合评估</p>
          <h1 className="text-3xl font-semibold">医院职工登录</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>工号登录</CardTitle>
            <CardDescription>请使用您的工号和密码登录</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="工号"
                type="text"
                autoComplete="username"
                placeholder="请输入工号"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <Input
                label="密码"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {error && (
                <p className="text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="min-h-12 w-full rounded-lg bg-primary-hover hover:translate-y-0" loading={loading}>
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

    </main>
  );
}

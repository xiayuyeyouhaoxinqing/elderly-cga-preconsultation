'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { abortRequest, ApiError, isRequestCancelled } from '@/lib/api/httpClient';
import { careRepository } from '@/lib/repositories';
import { runtimeConfig } from '@/lib/runtime/config';
import { useTaskStore } from '@/lib/stores/useTaskStore';
import { useUserStore } from '@/lib/stores/useUserStore';
import type { CareTask, User } from '@/lib/types';

const NO_TASKS: CareTask[] = [];

export function useVerifiedPatientTasks() {
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const hasHydrated = useUserStore((state) => state.hasHydrated);
  const cachedTasks = useTaskStore((state) => state.tasks);
  const sessionExpired = useRef(false);
  const [snapshot, setSnapshot] = useState<{ user: User; tasks: CareTask[]; error: string }>();
  const apiMode = runtimeConfig.dataMode === 'api';

  useEffect(() => {
    if (!apiMode || !hasHydrated) return;
    if (user?.role !== 'patient') {
      router.replace(sessionExpired.current ? '/patient?session=expired' : '/patient');
      return;
    }

    const controller = new AbortController();
    let timer: number | undefined;
    const isCurrent = () => !controller.signal.aborted && useUserStore.getState().user === user;

    const refresh = async () => {
      try {
        const tasks = await careRepository.listPatientTasks(controller.signal);
        if (!isCurrent()) return;
        useTaskStore.getState().setTasks(tasks);
        setSnapshot({ user, tasks, error: '' });
      } catch (error) {
        if (!isCurrent() || isRequestCancelled(error)) return;
        if (error instanceof ApiError && error.status === 401) {
          sessionExpired.current = true;
          abortRequest(controller);
          useTaskStore.getState().clearSessionData();
          useUserStore.getState().logout();
          router.replace('/patient?session=expired');
          return;
        }
        setSnapshot({ user, tasks: NO_TASKS, error: error instanceof Error ? error.message : '任务加载失败' });
      }
      if (isCurrent()) timer = window.setTimeout(refresh, 3000);
    };
    void refresh();
    return () => {
      window.clearTimeout(timer);
      abortRequest(controller);
    };
  }, [apiMode, hasHydrated, router, user]);

  if (!apiMode) return { tasks: cachedTasks, loadError: '', loading: false };
  const verified = user?.role === 'patient' && snapshot?.user === user ? snapshot : undefined;
  return { tasks: verified?.tasks ?? NO_TASKS, loadError: verified?.error ?? '', loading: !verified };
}

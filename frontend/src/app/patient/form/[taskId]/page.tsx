'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import PatientLayout from '@/components/layout/PatientLayout';
import QuestionCard from '@/components/assessment/QuestionCard';
import { PatientIcon } from '@/components/patient/PatientIcon';
import { PatientState } from '@/components/patient/PatientState';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Progress } from '@/components/shared/Progress';
import { Badge } from '@/components/shared/Badge';
import { IntegrationStatus } from '@/components/shared/IntegrationStatus';
import { careRepository } from '@/lib/repositories';
import { useVerifiedPatientTasks } from '@/lib/patient/useVerifiedPatientTasks';
import { runtimeConfig } from '@/lib/runtime/config';
import { useTaskStore } from '@/lib/stores/useTaskStore';
import { getVisibleQuestions, prototypeQuestions } from '@/lib/mock/assessment';
import type { PrototypeAnswerValue, QuestionnaireSnapshot } from '@/lib/types';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline';

const EMPTY_FORM_ANSWERS: Record<string, PrototypeAnswerValue> = {};

export default function PatientFormPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const apiMode = runtimeConfig.dataMode === 'api';
  const { tasks, loading: verifying, loadError } = useVerifiedPatientTasks();
  const task = tasks.find((item) => item.id === taskId);
  const mockAnswers = useTaskStore((state) => state.formDrafts[taskId] ?? EMPTY_FORM_ANSWERS);
  const mockReview = useTaskStore((state) => state.reviews[taskId]);
  const saveFormAnswer = useTaskStore((state) => state.saveFormAnswer);
  const submitForm = useTaskStore((state) => state.submitForm);
  const updateTask = useTaskStore((state) => state.updateTask);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentSection, setCurrentSection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [submitError, setSubmitError] = useState('');
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireSnapshot | null>(null);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(apiMode);
  const [edits, setEdits] = useState(EMPTY_FORM_ANSWERS);
  const lastSaved = useRef(EMPTY_FORM_ANSWERS);
  const saveQueue = useRef(Promise.resolve());
  const hasTask = Boolean(task);
  const questionnaireStatus = questionnaire?.status;
  const answers = useMemo(
    () => apiMode ? { ...questionnaire?.answerValues, ...edits } : mockAnswers,
    [apiMode, edits, mockAnswers, questionnaire]
  );

  useEffect(() => {
    if (!apiMode || !hasTask) return;
    const controller = new AbortController();
    void careRepository
      .getQuestionnaire(taskId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setQuestionnaire(snapshot);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSubmitError(error instanceof Error ? error.message : '问卷加载失败，请重试');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuestionnaireLoading(false);
      });
    return () => controller.abort();
  }, [apiMode, hasTask, taskId, task?.taskStatus]);

  const writable = questionnaireStatus === 'not_started'
    || questionnaireStatus === 'in_progress' || questionnaireStatus === 'returned';

  useEffect(() => {
    if (!apiMode || !writable || edits === lastSaved.current || isSubmitting || leaving) return;
    let current = true;
    const timer = globalThis.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (!current) return;
        try {
          await careRepository.saveQuestionnaireDraft(taskId, edits);
          lastSaved.current = edits;
          if (current) setDraftStatus('saved');
        } catch {
          if (current) setDraftStatus('error');
        }
      });
    }, 600);
    return () => {
      current = false;
      globalThis.clearTimeout(timer);
    };
  }, [apiMode, edits, isSubmitting, leaving, taskId, writable]);

  async function saveAndExit() {
    if (leaving || isSubmitting) return;
    setLeaving(true);
    setSubmitError('');
    try {
      await saveQueue.current;
      if (apiMode && writable && edits !== lastSaved.current) {
        await careRepository.saveQuestionnaireDraft(taskId, edits);
        lastSaved.current = edits;
      }
      router.push(`/patient/tasks/${taskId}`);
    } catch (error) {
      setDraftStatus('error');
      setSubmitError(error instanceof Error ? error.message : '草稿保存失败，请重试');
    } finally {
      setLeaving(false);
    }
  }

  const visibleQuestions = useMemo(
    () => {
      if (apiMode) {
        return questionnaire?.questions ?? [];
      }
      return getVisibleQuestions(
        answers,
        task?.scaleIds ?? (task?.scaleId ? [task.scaleId] : undefined)
      );
    },
    [answers, apiMode, questionnaire, task]
  );
  const sections = useMemo(
    () =>
      visibleQuestions.reduce<Record<string, typeof prototypeQuestions>>((result, question) => {
        const name = question.sectionName ?? '其他';
        result[name] = [...(result[name] ?? []), question];
        return result;
      }, {}),
    [visibleQuestions]
  );
  const sectionNames = Object.keys(sections);
  const safeSectionIndex = Math.min(currentSection, Math.max(sectionNames.length - 1, 0));
  const currentQuestions = sections[sectionNames[safeSectionIndex]] ?? [];
  const requiredQuestions = visibleQuestions.filter(
    (question) => question.required && !question.derived
  );
  const answeredCount = requiredQuestions.filter((question) => {
    const answer = answers[question.id];
    return Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '';
  }).length;

  const handleAnswer = (questionId: string, value: PrototypeAnswerValue) => {
    if (apiMode) {
      setEdits((current) => ({ ...current, [questionId]: value }));
      setDraftStatus('saving');
      setErrors((current) => ({ ...current, [questionId]: '' }));
      return;
    }
    const previousValue = answers[questionId];
    const wasAnswered = Array.isArray(previousValue)
      ? previousValue.length > 0
      : previousValue !== undefined && previousValue !== null && previousValue !== '';
    const nextAnsweredCount = wasAnswered
      ? answeredCount
      : Math.min(answeredCount + 1, requiredQuestions.length);
    saveFormAnswer(taskId, questionId, value);
    setErrors((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
    updateTask(taskId, {
      taskStatus: 'in_progress',
      progress: { current: nextAnsweredCount, total: requiredQuestions.length },
    });
  };

  const validateSection = () => {
    const nextErrors: Record<string, string> = {};
    currentQuestions.forEach((question) => {
      const answer = answers[question.id];
      if (
        question.required &&
        (answer === undefined ||
          answer === null ||
          answer === '' ||
          (Array.isArray(answer) && answer.length === 0))
      ) {
        nextErrors[question.id] = '此题为必填项';
      }
      if (question.questionType === 'number' && answer !== undefined && answer !== '') {
        const value = Number(answer);
        if (question.validationRule?.min !== undefined && value < question.validationRule.min) {
          nextErrors[question.id] = `数值不能小于 ${question.validationRule.min}`;
        }
        if (question.validationRule?.max !== undefined && value > question.validationRule.max) {
          nextErrors[question.id] = `数值不能大于 ${question.validationRule.max}`;
        }
      }
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const nextSection = () => {
    if (!validateSection()) return;
    setCurrentSection((value) => Math.min(value + 1, sectionNames.length - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const previousSection = () => {
    setCurrentSection((value) => Math.max(value - 1, 0));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async () => {
    if (leaving || isSubmitting || (apiMode && !writable)) return;
    if (!validateSection()) return;
    if (answeredCount !== requiredQuestions.length) {
      const firstMissing = requiredQuestions.find((question) => {
        const answer = answers[question.id];
        return answer === undefined || answer === null || answer === '';
      });
      if (firstMissing?.sectionName) {
        setCurrentSection(sectionNames.indexOf(firstMissing.sectionName));
        setErrors({ [firstMissing.id]: '请先完成此必填项' });
      }
      return;
    }
    setIsSubmitting(true);
    setSubmitError('');
    try {
      await saveQueue.current;
      await careRepository.submitQuestionnaire(taskId, apiMode ? edits : answers);
      if (apiMode) {
        lastSaved.current = edits;
        setQuestionnaire((current) => current && { ...current, status: 'submitted' });
        updateTask(taskId, { taskStatus: 'pending_review' });
      } else {
        submitForm(taskId, requiredQuestions.length);
      }
      if (task?.consentRequired) {
        updateTask(taskId, { taskStatus: 'in_progress' });
      }
      const nextPath = task?.consentRequired
        ? `/patient/consent/${taskId}`
        : `/patient/complete/${taskId}`;
      router.push(nextPath);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : '问卷提交失败，请重试'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (verifying || (hasTask && questionnaireLoading)) {
    return (
      <PatientLayout title="传统问卷评估" showBack>
        <div className="p-[18px]">
          <PatientState kind="loading" title="正在加载量表" description="读取本次评估的题目和已保存答案。" />
        </div>
      </PatientLayout>
    );
  }

  if (!task || (apiMode && !questionnaire)) {
    return (
      <PatientLayout title="传统问卷" showBack>
        <div className="p-[18px]">
          <PatientState
            kind="empty-tasks"
            title={loadError || submitError ? '问卷加载失败' : '任务不存在'}
            description={loadError || submitError || '请返回任务中心查看最新护理任务。'}
          />
        </div>
      </PatientLayout>
    );
  }

  if (
    apiMode &&
    questionnaire &&
    (questionnaire.status === 'submitted' || questionnaire.status === 'confirmed')
  ) {
    return (
      <PatientLayout title="传统问卷评估" showBack onBack={() => router.push(`/patient/tasks/${taskId}`)}>
        <div className="p-[18px]">
          <Card padding="lg" className="patient-card text-center">
            <CheckCircleIcon className="w-10 h-10 mx-auto text-primary mb-3" />
            <p className="font-medium">
              {questionnaire.status === 'confirmed'
                ? '问卷结果已由护士确认'
                : '问卷已提交，等待护士复核'}
            </p>
            <Button className="mt-5 w-full" onClick={() => router.push(`/patient/tasks/${taskId}`)}>
              返回任务详情
            </Button>
          </Card>
        </div>
      </PatientLayout>
    );
  }

  const returned = apiMode ? questionnaireStatus === 'returned' : mockReview?.status === 'returned';
  const returnReason = apiMode ? questionnaire?.returnReason : mockReview?.returnReason;
  return (
    <PatientLayout title="传统问卷评估" showBack onBack={() => void saveAndExit()}>
      <div className="min-h-screen bg-background pb-28">
        <div className="sticky top-16 z-30 border-b border-border bg-[#fffaf6]/95 p-4 backdrop-blur">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-tint text-primary">
                  <PatientIcon name="document" className="h-5 w-5" />
                </span>
                <span className="text-sm font-black">{sectionNames[safeSectionIndex]}</span>
              </div>
              <div className="flex items-center gap-2">
                <IntegrationStatus compact />
                <Badge variant="primary" size="sm">
                  {answeredCount}/{requiredQuestions.length}
                </Badge>
              </div>
            </div>
            <Progress value={answeredCount} max={requiredQuestions.length} size="md" />
            <div role="status" className="mt-2 flex items-center gap-1 text-sm text-foreground-muted">
              <CloudArrowUpIcon className="w-4 h-4" />
              {draftStatus === 'saving'
                ? '正在保存草稿…'
                : draftStatus === 'error'
                  ? '草稿保存失败，当前页面仍保留你的修改'
                  : apiMode
                    ? draftStatus === 'saved' || questionnaire?.updatedAt && questionnaire.answers.length > 0
                      ? '草稿已保存，可退出后继续'
                      : '填写时会自动保存草稿'
                    : '演示答案保存在当前标签页'}
            </div>
          </div>
        </div>

        <div className="space-y-4 p-[18px]">
          {returned && (
            <Card padding="md" className="border-primary/40 bg-primary-tint">
              <h2 className="font-semibold">请补充问卷</h2>
              <p className="mt-1 whitespace-pre-wrap break-words">{returnReason || '请联系职工了解需要补充的内容。'}</p>
            </Card>
          )}
          {submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}
          <fieldset disabled={leaving || isSubmitting} className="space-y-4">
            {currentQuestions.map((question) => (
              <QuestionCard
                key={question.id}
                question={question}
                value={answers[question.id]}
                onChange={(value) => handleAnswer(question.id, value)}
                error={errors[question.id]}
              />
            ))}
          </fieldset>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px] border-t border-border bg-surface/95 p-4 shadow-[0_-10px_28px_rgba(94,67,48,.08)] backdrop-blur safe-area-pb min-[520px]:bottom-4 min-[520px]:rounded-b-[34px]">
          <div className="flex gap-3">
            <Button variant="outline" loading={leaving} disabled={isSubmitting} onClick={() => void saveAndExit()}>
              保存并退出
            </Button>
            {safeSectionIndex > 0 && (
              <Button variant="outline" disabled={leaving || isSubmitting} onClick={previousSection}>
                <ArrowLeftIcon className="w-4 h-4 mr-1" />
                上一步
              </Button>
            )}
            {safeSectionIndex < sectionNames.length - 1 ? (
              <Button className="flex-1" disabled={leaving} onClick={nextSection}>
                下一步
                <ArrowRightIcon className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button className="flex-1" loading={isSubmitting} disabled={leaving} onClick={submit}>
                <CheckCircleIcon className="w-4 h-4 mr-1" />
                检查并提交
              </Button>
            )}
          </div>
        </div>
      </div>
    </PatientLayout>
  );
}

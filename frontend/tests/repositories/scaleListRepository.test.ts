import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCareRepository } from '@/lib/repositories/apiRepository';
import { MockCareRepository } from '@/lib/repositories/mockRepository';

afterEach(() => vi.unstubAllGlobals());

describe('published scale list', () => {
  it('保留旧调用、传递过滤参数并映射版本和题目数', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      code: 'OK', message: '成功', data: [{ id: 1, scale_code: 'test', scale_name: '营养',
        scale_type: '测试', question_count: 0, version_code: 'v1' }],
    }), { headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const repo = new ApiCareRepository();
    const rows = await repo.listScales(undefined, { keyword: ' 营养%_ ' });
    expect(String(fetchMock.mock.calls[0][0])).toContain(new URLSearchParams({ keyword: '营养%_' }).toString());
    expect(rows[0]).toMatchObject({ id: '1', versionCode: 'v1', questionCount: 0 });
    await repo.listScales();
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/scales$/);
  });

  it('API失败不回退Mock', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(new ApiCareRepository().listScales()).rejects.toThrow();
  });

  it('Mock空白返回全部，无匹配返回空数组，百分号作为文字', async () => {
    const repo = new MockCareRepository();
    const all = await repo.listScales();
    expect(await repo.listScales(undefined, { keyword: '  ' })).toEqual(all);
    expect(await repo.listScales(undefined, { keyword: '完全不存在的量表XYZ' })).toEqual([]);
    const selected = await repo.listScales(undefined, { keyword: '%' });
    expect(selected.every((row) => row.scaleName.includes('%'))).toBe(true);
    if (all.length) {
      expect(await repo.listScales(undefined, { keyword: ` ${all[0].scaleName} ` })).toContainEqual(all[0]);
    }
  });
});

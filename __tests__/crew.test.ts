import { describe, expect, it } from 'vitest';
import { searchCrew, splitOrgName, type CrewMember } from '@/lib/production/crew';

// 실제 사람 이름은 저장소에 두지 않는다 — 시험용 가짜 이름
const m = (name: string, extra: Partial<CrewMember> = {}): CrewMember => ({
  id: name, name, full_name: '', department: '생산부', position: '사원', aliases: [], sort_order: 0, active: true, ...extra,
});

describe('생산 인원 명단', () => {
  it('조직도 성명 칸을 이름 · 영문으로 — 괄호가 겹친 오타도', () => {
    expect(splitOrgName('가나다(GANA DA)')).toEqual({ name: '가나다', english: 'GANA DA' });
    expect(splitOrgName('라마바(RAMA BA))')).toEqual({ name: '라마바', english: 'RAMA BA' });
    expect(splitOrgName(' 사아자 ')).toEqual({ name: '사아자', english: '' });
  });

  it('찾기 — 이름 · 다른 표기 · 영문 어디든, 앞에서 맞는 사람이 위, 그만둔 사람은 뺀다', () => {
    const list = [
      m('하나둘', { full_name: '하나둘(HANA DUL)' }),
      m('둘셋', { aliases: ['둘쎗'] }),
      m('넷다섯', { active: false }),
    ];
    expect(searchCrew(list, '').map(x => x.name)).toEqual(['하나둘', '둘셋']);
    expect(searchCrew(list, '둘').map(x => x.name)).toEqual(['둘셋', '하나둘']);
    expect(searchCrew(list, '둘쎗').map(x => x.name)).toEqual(['둘셋']);
    expect(searchCrew(list, 'hana').map(x => x.name)).toEqual(['하나둘']);
    expect(searchCrew(list, '넷')).toEqual([]);
  });
});

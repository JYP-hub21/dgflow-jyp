import {
  LayoutDashboard, FileCheck, Factory, Database, Users, FileSpreadsheet, ScanLine, ClipboardList, Inbox, Upload, Send,
} from 'lucide-react';

/** 메뉴 정의(lib/auth/role-guard.ts 의 `icon` 이름) → 아이콘. 사이드바와 대시보드가 같이 쓴다 */
export const MENU_ICONS: Record<string, React.ElementType> = {
  LayoutDashboard, FileCheck, Factory, Database, Users, FileSpreadsheet, ScanLine, ClipboardList, Inbox, Upload, Send,
};

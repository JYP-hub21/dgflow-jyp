import PermissionGate from '@/components/layout/PermissionGate';
import { ORDER_ANY } from '@/lib/auth/role-guard';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PermissionGate permission={ORDER_ANY}>{children}</PermissionGate>;
}

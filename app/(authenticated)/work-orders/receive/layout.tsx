import PermissionGate from '@/components/layout/PermissionGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PermissionGate permission="work_order:create">{children}</PermissionGate>;
}

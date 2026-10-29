import PermissionGate from '@/components/layout/PermissionGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <PermissionGate permission="erp:generate">{children}</PermissionGate>;
}

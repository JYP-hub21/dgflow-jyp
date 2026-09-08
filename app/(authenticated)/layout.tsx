import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/get-user';
import Sidebar from '@/components/layout/Sidebar';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex h-screen">
      <Sidebar userName={user.name} userRole={user.role} />
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        {children}
      </main>
    </div>
  );
}

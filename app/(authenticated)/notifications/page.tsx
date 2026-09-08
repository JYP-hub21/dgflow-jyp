'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { CheckCheck } from 'lucide-react';

interface Notification {
  id: string;
  type: string;
  message: string;
  order_id: string | null;
  is_read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const res = await fetch('/api/notifications');
    if (res.ok) {
      const { data } = await res.json();
      setNotifications(data);
    }
  }

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAll: true }),
    });
    load();
  }

  const unread = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">알림 {unread > 0 && <Badge className="ml-2">{unread}</Badge>}</h1>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="mr-2 h-4 w-4" />모두 읽음
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">알림이 없습니다</p>
          ) : (
            notifications.map(n => (
              <Link
                key={n.id}
                href={n.order_id ? `/orders/${n.order_id}` : '#'}
                className={`flex items-center justify-between px-4 py-3 border-b last:border-0 hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50' : ''}`}
              >
                <div>
                  <p className="text-sm">{n.message}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(n.created_at).toLocaleString('ko-KR')}
                  </p>
                </div>
                {!n.is_read && <Badge variant="default" className="text-[10px]">NEW</Badge>}
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

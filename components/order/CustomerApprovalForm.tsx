'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle } from 'lucide-react';

export default function CustomerApprovalForm({ token, orderId }: { token: string; orderId: string }) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<'approved' | 'rejected' | null>(null);

  async function handleAction(action: 'approve' | 'reject') {
    setLoading(true);
    const res = await fetch('/api/approvals/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, order_id: orderId, action, comment }),
    });
    setLoading(false);
    if (res.ok) {
      setDone(true);
      setResult(action === 'approve' ? 'approved' : 'rejected');
    }
  }

  if (done) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          {result === 'approved' ? (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="text-lg font-medium">승인이 완료되었습니다.</p>
              <p className="text-sm text-gray-500 mt-1">감사합니다.</p>
            </>
          ) : (
            <>
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
              <p className="text-lg font-medium">반려 처리되었습니다.</p>
              <p className="text-sm text-gray-500 mt-1">담당자가 수정 후 다시 전송할 예정입니다.</p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">승인/반려</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          placeholder="의견을 입력하세요 (선택사항)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
        />
        <div className="flex gap-3">
          <Button onClick={() => handleAction('approve')} disabled={loading} className="flex-1">
            <CheckCircle className="mr-2 h-4 w-4" />승인
          </Button>
          <Button variant="destructive" onClick={() => handleAction('reject')} disabled={loading} className="flex-1">
            <XCircle className="mr-2 h-4 w-4" />반려
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

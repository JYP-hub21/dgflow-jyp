'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STATUS_TRANSITIONS, ORDER_STATUS, type OrderStatus } from '@/types/order-status';
import type { UserRole } from '@/types/user';
import { Send, CheckCircle, XCircle, FileDown, Copy, Check, Link as LinkIcon, Factory } from 'lucide-react';

interface OrderActionsProps {
  orderId: string;
  currentStatus: OrderStatus;
  userRole: UserRole;
}

const ROLE_ACTIONS: Record<string, OrderStatus[]> = {
  construction_mgr: ['completed', 'pending_customer'],
  biz_support: ['under_review', 'review_completed'],
  admin: ['final_approved', 'rejected_by_admin', 'review_completed'],
  system_admin: ['completed', 'pending_customer', 'under_review', 'review_completed', 'final_approved', 'rejected_by_admin', 'work_order_created'],
};

const ACTION_LABELS: Partial<Record<OrderStatus, { label: string; icon: typeof Send; variant: 'default' | 'destructive' | 'outline' }>> = {
  completed: { label: '작성 완료', icon: CheckCircle, variant: 'default' },
  pending_customer: { label: '고객에게 승인 요청', icon: Send, variant: 'default' },
  under_review: { label: '검토 시작', icon: CheckCircle, variant: 'default' },
  review_completed: { label: '검토 완료', icon: CheckCircle, variant: 'default' },
  final_approved: { label: '최종 승인', icon: CheckCircle, variant: 'default' },
  rejected_by_admin: { label: '반려', icon: XCircle, variant: 'destructive' },
  erp_completed: { label: 'ERP 입력 완료', icon: FileDown, variant: 'default' },
  work_order_created: { label: '작업의뢰서 생성', icon: Factory, variant: 'default' },
};

export default function OrderActions({ orderId, currentStatus, userRole }: OrderActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [approvalLink, setApprovalLink] = useState('');
  const [copied, setCopied] = useState(false);

  const possibleTransitions = STATUS_TRANSITIONS[currentStatus] || [];
  const roleActions = ROLE_ACTIONS[userRole] || [];
  const availableActions = possibleTransitions.filter(s => roleActions.includes(s));

  async function handleSendToCustomer() {
    setLoading(true);
    // 1. 고객 승인 토큰 생성 + 상태 변경
    const res = await fetch('/api/approvals/customer-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });

    if (res.ok) {
      const { url } = await res.json();
      setApprovalLink(url);
    }
    setLoading(false);
    router.refresh();
  }

  async function handleWorkOrderCreate() {
    setLoading(true);
    await fetch('/api/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    setLoading(false);
    router.refresh();
  }

  async function handleFinalApprove() {
    setLoading(true);
    // 1. 최종승인 상태 변경
    await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'final_approved' }),
    });
    // 2. 작업의뢰서 자동 생성
    await fetch('/api/work-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    });
    setLoading(false);
    router.refresh();
  }

  async function handleAction(newStatus: OrderStatus) {
    setLoading(true);
    await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    setLoading(false);
    router.refresh();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(approvalLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (availableActions.length === 0 && !approvalLink) return null;

  return (
    <div className="space-y-4">
      {/* 고객 승인 링크 표시 */}
      {(approvalLink || currentStatus === 'pending_customer') && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-800">고객 승인 링크</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvalLink ? (
              <>
                <p className="text-xs text-blue-600">아래 링크를 고객에게 전달하세요. 고객은 로그인 없이 주문의뢰서를 확인하고 승인/반려할 수 있습니다.</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-white rounded-lg border px-3 py-2">
                    <LinkIcon className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="text-sm font-mono text-gray-700 truncate">{approvalLink}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? '복사됨' : '복사'}
                  </Button>
                </div>
                <div className="flex gap-2 text-xs text-blue-500">
                  <span>카카오톡이나 이메일로 전달하세요</span>
                  <span>|</span>
                  <span>유효기간: 7일</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-blue-600">고객에게 승인 요청을 전송했습니다. 고객의 승인을 기다리고 있습니다.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 액션 버튼 */}
      {availableActions.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {availableActions.map(status => {
            // 고객 전송은 별도 핸들러
            if (status === 'pending_customer') {
              return (
                <Button key={status} onClick={handleSendToCustomer} disabled={loading}>
                  <Send className="mr-2 h-4 w-4" />
                  고객에게 승인 요청
                </Button>
              );
            }

            // 고객 전송 취소 (pending_customer → completed 복귀)
            if (status === 'completed' && currentStatus === 'pending_customer') {
              return (
                <Button key="cancel_send" variant="destructive" onClick={() => handleAction('completed' as OrderStatus)} disabled={loading}>
                  <XCircle className="mr-2 h-4 w-4" />
                  전송 취소
                </Button>
              );
            }

            // 최종승인 → 작업의뢰서 자동 생성
            if (status === 'final_approved') {
              return (
                <Button key={status} onClick={handleFinalApprove} disabled={loading}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  최종 승인 (작업의뢰서 자동 생성)
                </Button>
              );
            }

            // 승인 취소 (final_approved 상태에서 review_completed로 복귀)
            if (status === 'review_completed' && currentStatus === 'final_approved') {
              return (
                <Button key="cancel_approve" variant="destructive" onClick={() => handleAction('review_completed' as OrderStatus)} disabled={loading}>
                  <XCircle className="mr-2 h-4 w-4" />
                  승인 취소
                </Button>
              );
            }

            // 작업의뢰서 수동 생성 (하위호환)
            if (status === 'work_order_created') {
              return (
                <Button key={status} onClick={handleWorkOrderCreate} disabled={loading}>
                  <Factory className="mr-2 h-4 w-4" />
                  작업의뢰서 생성
                </Button>
              );
            }

            const action = ACTION_LABELS[status];
            if (!action) return null;
            const Icon = action.icon;
            return (
              <Button
                key={status}
                variant={action.variant}
                onClick={() => handleAction(status)}
                disabled={loading}
              >
                <Icon className="mr-2 h-4 w-4" />
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

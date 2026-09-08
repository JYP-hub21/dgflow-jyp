'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Paperclip, Upload, X, Download, Image, FileSpreadsheet, FileText, Eye, Loader2 } from 'lucide-react';

interface Attachment {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  category: string;
  created_at: string;
  uploader?: { name: string };
}

interface OrderAttachmentsProps {
  orderId: string;
  editable: boolean;
  initialAttachments?: Attachment[];
}

const CATEGORY_LABELS: Record<string, string> = {
  purchase_order: '고객 발주서',
  chat_capture: '카톡/메시지',
  site_photo: '현장 사진',
  etc: '기타',
};

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <Image className="h-4 w-4 text-blue-500" />;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return <FileSpreadsheet className="h-4 w-4 text-green-600" />;
  if (mimeType.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
  return <Paperclip className="h-4 w-4 text-gray-500" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OrderAttachments({ orderId, editable, initialAttachments = [] }: OrderAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File, category: string) => {
    setError('');
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', category);

      const res = await fetch(`/api/orders/${orderId}/attachments`, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || '업로드 실패');
        return;
      }

      setAttachments(prev => [...prev, result.data]);
    } catch {
      setError('업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  }, [orderId]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    // 파일 확장자로 카테고리 자동 분류
    for (const file of Array.from(files)) {
      const category = guessCategory(file);
      uploadFile(file, category);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function guessCategory(file: File): string {
    if (file.type.startsWith('image/')) return 'chat_capture';
    if (file.type.includes('spreadsheet') || file.type.includes('excel')) return 'purchase_order';
    if (file.type.includes('pdf')) return 'purchase_order';
    return 'etc';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!editable) return;

    const files = e.dataTransfer.files;
    for (const file of Array.from(files)) {
      uploadFile(file, guessCategory(file));
    }
  }

  async function handleDelete(attachmentId: string) {
    if (!confirm('첨부파일을 삭제하시겠습니까?')) return;

    const res = await fetch(`/api/orders/${orderId}/attachments`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachmentId }),
    });

    if (res.ok) {
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
    }
  }

  async function handlePreview(attachment: Attachment) {
    const res = await fetch(`/api/orders/${orderId}/attachments/url?path=${encodeURIComponent(attachment.file_path)}`);
    const { url } = await res.json();
    if (!url) return;

    if (attachment.mime_type.startsWith('image/')) {
      setPreviewName(attachment.file_name);
      setPreviewUrl(url);
    } else {
      window.open(url, '_blank');
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            참고자료 ({attachments.length})
          </CardTitle>
          {editable && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.xlsx,.xls,.pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-1"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                파일 첨부
              </Button>
            </>
          )}
        </CardHeader>
        <CardContent>
          {/* 드래그 앤 드롭 영역 */}
          {editable && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-4 mb-4 text-center text-sm transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400'
              }`}
            >
              {dragOver
                ? '여기에 놓으세요'
                : '카톡 캡처, 고객 발주서, 현장 사진 등을 드래그하거나 위 버튼으로 첨부하세요'
              }
              <p className="text-xs mt-1">이미지(PNG/JPG), 엑셀(XLSX), PDF | 최대 10MB/건, 10개까지</p>
            </div>
          )}

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          {/* 파일 목록 */}
          {attachments.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-2">첨부된 파일이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {attachments.map(att => (
                <div key={att.id} className="flex items-center gap-3 p-2 rounded-lg border hover:bg-gray-50 group">
                  {fileIcon(att.mime_type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{att.file_name}</p>
                    <p className="text-xs text-gray-400">
                      {CATEGORY_LABELS[att.category] || att.category} · {formatSize(att.file_size)}
                      {att.uploader && ` · ${att.uploader.name}`}
                      {' · '}{new Date(att.created_at).toLocaleDateString('ko-KR')}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" onClick={() => handlePreview(att)} title="미리보기/다운로드">
                      {att.mime_type.startsWith('image/') ? <Eye className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                    </Button>
                    {editable && (
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(att.id)} title="삭제">
                        <X className="h-4 w-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 이미지 미리보기 모달 */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] p-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm">{previewName}</span>
              <Button variant="ghost" size="sm" onClick={() => setPreviewUrl(null)}>
                <X className="h-5 w-5 text-white" />
              </Button>
            </div>
            <img src={previewUrl} alt={previewName} className="max-w-full max-h-[80vh] rounded-lg object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

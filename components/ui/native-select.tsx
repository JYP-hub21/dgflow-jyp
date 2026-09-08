import { cn } from '@/lib/utils';
import { SELECT_CLASS } from '@/types/order-form';

interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

export default function NativeSelect({ className, children, ...props }: NativeSelectProps) {
  return (
    <select className={cn(SELECT_CLASS, className)} {...props}>
      {children}
    </select>
  );
}

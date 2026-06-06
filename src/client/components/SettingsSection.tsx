import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@client/components/ui';
import { cn } from '@client/lib/cn';

export interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className={cn('grid gap-5')}>{children}</CardContent>
    </Card>
  );
}

export default SettingsSection;

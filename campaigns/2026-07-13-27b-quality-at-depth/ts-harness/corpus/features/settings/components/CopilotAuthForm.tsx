import { ChevronRight, Loader2 } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface CopilotAuthFormProps {
  readonly isAuthenticated: boolean;
  readonly username: string | null;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onHealthCheck: () => void;
  readonly isChecking: boolean;
  readonly healthCheckResult: 'success' | 'failure' | null;
  readonly isSigningIn: boolean;
  readonly enterpriseDomain: string;
  readonly onEnterpriseDomainChange: (value: string) => void;
  readonly className?: string;
  readonly labels: {
    readonly signIn: string;
    readonly signOut: string;
    readonly connectedAs: string;
    readonly testConnection: string;
    readonly checking: string;
    readonly connected: string;
    readonly failed: string;
    readonly advanced: string;
    readonly enterpriseDomain: string;
    readonly enterprisePlaceholder: string;
  };
}

function extractInputValue(e: React.ChangeEvent<HTMLInputElement>): string {
  return e.target.value;
}

function getHealthCheckButtonLabel(
  isChecking: boolean,
  checkingLabel: string,
  testLabel: string
): string {
  return isChecking ? checkingLabel : testLabel;
}

function formatUsername(connectedAsLabel: string, username: string | null): string {
  return `${connectedAsLabel} @${username ?? ''}`;
}

function HealthCheckResult({
  result,
  connectedLabel,
  failedLabel,
}: {
  readonly result: 'success' | 'failure' | null;
  readonly connectedLabel: string;
  readonly failedLabel: string;
}): React.ReactElement | null {
  if (result === 'success') {
    return <span className="text-sm text-green-500">{connectedLabel}</span>;
  }

  if (result === 'failure') {
    return <span className="text-sm text-destructive">{failedLabel}</span>;
  }

  return null;
}

function AuthenticatedView({
  username,
  onSignOut,
  onHealthCheck,
  isChecking,
  healthCheckResult,
  labels,
}: {
  readonly username: string | null;
  readonly onSignOut: () => void;
  readonly onHealthCheck: () => void;
  readonly isChecking: boolean;
  readonly healthCheckResult: 'success' | 'failure' | null;
  readonly labels: CopilotAuthFormProps['labels'];
}): React.ReactElement {
  const healthCheckButtonLabel = getHealthCheckButtonLabel(
    isChecking,
    labels.checking,
    labels.testConnection
  );
  const usernameDisplay = formatUsername(labels.connectedAs, username);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
        <span className="text-sm">{usernameDisplay}</span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSignOut}
        aria-label={labels.signOut}
        className="w-fit text-destructive hover:text-destructive"
      >
        {labels.signOut}
      </Button>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onHealthCheck}
          disabled={isChecking}
          aria-label={healthCheckButtonLabel}
        >
          {healthCheckButtonLabel}
        </Button>
        <HealthCheckResult
          result={healthCheckResult}
          connectedLabel={labels.connected}
          failedLabel={labels.failed}
        />
      </div>
    </div>
  );
}

function UnauthenticatedView({
  onSignIn,
  isSigningIn,
  labels,
}: {
  readonly onSignIn: () => void;
  readonly isSigningIn: boolean;
  readonly labels: CopilotAuthFormProps['labels'];
}): React.ReactElement {
  return (
    <Button type="button" onClick={onSignIn} disabled={isSigningIn} aria-label={labels.signIn}>
      {isSigningIn && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
      {labels.signIn}
    </Button>
  );
}

function AdvancedSection({
  enterpriseDomain,
  onEnterpriseDomainChange,
  labels,
}: {
  readonly enterpriseDomain: string;
  readonly onEnterpriseDomainChange: (value: string) => void;
  readonly labels: CopilotAuthFormProps['labels'];
}): React.ReactElement {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onEnterpriseDomainChange(extractInputValue(e));
  };

  return (
    <details className="group mt-2">
      <summary
        className="flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        aria-label={labels.advanced}
      >
        <ChevronRight
          className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          aria-hidden="true"
        />
        {labels.advanced}
      </summary>

      <div className="mt-3 flex flex-col gap-2">
        <Label htmlFor="copilot-enterprise-domain">{labels.enterpriseDomain}</Label>
        <Input
          id="copilot-enterprise-domain"
          type="url"
          value={enterpriseDomain}
          onChange={handleChange}
          placeholder={labels.enterprisePlaceholder}
          aria-label={labels.enterpriseDomain}
        />
      </div>
    </details>
  );
}

export function CopilotAuthForm({
  isAuthenticated,
  username,
  onSignIn,
  onSignOut,
  onHealthCheck,
  isChecking,
  healthCheckResult,
  isSigningIn,
  enterpriseDomain,
  onEnterpriseDomainChange,
  className,
  labels,
}: CopilotAuthFormProps): React.ReactElement {
  if (isAuthenticated) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <AuthenticatedView
          username={username}
          onSignOut={onSignOut}
          onHealthCheck={onHealthCheck}
          isChecking={isChecking}
          healthCheckResult={healthCheckResult}
          labels={labels}
        />
        <AdvancedSection
          enterpriseDomain={enterpriseDomain}
          onEnterpriseDomainChange={onEnterpriseDomainChange}
          labels={labels}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <UnauthenticatedView onSignIn={onSignIn} isSigningIn={isSigningIn} labels={labels} />
      <AdvancedSection
        enterpriseDomain={enterpriseDomain}
        onEnterpriseDomainChange={onEnterpriseDomainChange}
        labels={labels}
      />
    </div>
  );
}

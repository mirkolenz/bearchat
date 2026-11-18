import { useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { config } from "@/lib/config";
import { type Session, rememberedBaseURL, signIn } from "@/lib/connection";
import { errorMessage } from "@/lib/utils";

interface LoginProps {
  error?: string;
  onSignIn: (session: Session) => void;
}

export function Login({ error: initialError, onSignIn }: LoginProps) {
  const [baseURL, setBaseURL] = useState(rememberedBaseURL);
  const [token, setToken] = useState("");
  const [error, submit, pending] = useActionState(async () => {
    try {
      onSignIn(await signIn(baseURL, token.trim()));
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }, initialError);

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <form action={submit} className="w-full max-w-sm">
        <FieldGroup>
          <h1 className="text-2xl font-semibold">{config.title}</h1>
          {config.baseURL === undefined && (
            <Field>
              <FieldLabel htmlFor="base-url">Server URL</FieldLabel>
              <Input
                id="base-url"
                type="url"
                required
                placeholder="https://openrouter.ai/api/v1"
                value={baseURL}
                onChange={(event) => setBaseURL(event.target.value)}
              />
              <FieldDescription>
                An OpenAI-compatible endpoint, including the /v1 suffix.
              </FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="token">Token</FieldLabel>
            <Input
              id="token"
              type="password"
              autoComplete="current-password"
              required={config.baseURL !== undefined}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            <FieldDescription>
              {config.auth === "cookie"
                ? "Stored in a secure cookie that scripts cannot read."
                : "Kept in this tab only and cleared when it closes."}
            </FieldDescription>
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            Sign in
          </Button>
        </FieldGroup>
      </form>
    </main>
  );
}

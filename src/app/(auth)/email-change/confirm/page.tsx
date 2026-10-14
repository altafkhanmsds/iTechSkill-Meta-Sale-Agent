"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, MailCheck, Loader2, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function ConfirmEmailChangePage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailChangePageInner />
    </Suspense>
  );
}

function ConfirmEmailChangePageInner() {
  const searchParams = useSearchParams();
  const { signOut } = useAuth();
  
  const [tokenHash] = useState(() => searchParams.get("token_hash"));
  const [type] = useState(() => searchParams.get("type"));
  const [code] = useState(() => searchParams.get("code"));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);
  
  const supabase = createClient();

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      if (window.location.hash || searchParams.has('code') || searchParams.has('token_hash')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const { data: { user } } = await supabase.auth.getUser();
      
      if (mounted) {
        if (user && !code && (!tokenHash || type !== "email_change")) {
          setSuccess(true);
          setTimeout(async () => {
            await signOut();
          }, 2500);
        }
        setReady(true);
      }
    }

    checkSession();
    return () => { mounted = false; };
  }, [supabase, code, tokenHash, type, searchParams, signOut]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!success && !code && (!tokenHash || type !== "email_change")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
              <AlertCircle className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Invalid confirmation link
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              This link is missing required information or is improperly formatted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Back to sign in
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleVerify = async () => {
    setLoading(true);
    setError(null);

    try {
      if (code) {
        const { error: verifyError } = await supabase.auth.exchangeCodeForSession(code);
        if (verifyError) throw verifyError;
      } else if (tokenHash && type === 'email_change') {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'email_change'
        });
        if (verifyError) throw verifyError;
      }

      setSuccess(true);
      setLoading(false);
      
      setTimeout(async () => {
        await signOut();
      }, 2500);
      
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes('rate limit')) {
        setError("Too many attempts. Please try again later.");
      } else if (err?.message?.toLowerCase().includes('expired') || err?.message?.toLowerCase().includes('invalid')) {
        setError("This link has expired, is invalid, or has already been used.");
      } else {
        setError("Failed to verify the email change link. Please try again.");
      }
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <MailCheck className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Email confirmed successfully
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Email confirmed successfully. Sign in with your new email. You will be redirected momentarily.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MailCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Confirm email change
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Click below to securely confirm the change of your login email address.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={handleVerify}
            disabled={loading}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying link...
              </>
            ) : (
              "Confirm email change"
            )}
          </Button>

          <Link
            href="/login"
            className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

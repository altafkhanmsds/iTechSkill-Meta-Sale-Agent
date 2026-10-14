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
import { AlertCircle, KeyRound, Loader2, ArrowLeft } from "lucide-react";

export default function ConfirmRecoveryPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmRecoveryPageInner />
    </Suspense>
  );
}

function ConfirmRecoveryPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const supabase = createClient();

  // If missing required params, show error
  if (!tokenHash || type !== "recovery") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
              <AlertCircle className="h-6 w-6 text-amber-400" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Invalid recovery link
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              This link is missing required information or is improperly formatted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/forgot-password">
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Request new link
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
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery'
      });

      if (verifyError) {
        if (verifyError.message.toLowerCase().includes('rate limit')) {
          setError("Too many attempts. Please try again later.");
        } else if (verifyError.message.toLowerCase().includes('expired') || verifyError.message.toLowerCase().includes('invalid')) {
          setError("This link has expired, is invalid, or has already been used.");
        } else {
          setError("Failed to verify the recovery link. Please try requesting a new one.");
        }
        setLoading(false);
        return;
      }

      // On success, clean the URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Navigate to actual reset password page
      router.push("/reset-password");
      
    } catch (err) {
      setError("A network error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            Confirm password reset
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Click below to verify this link and securely continue to the password reset page.
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
              "Continue to reset password"
            )}
          </Button>

          {error && (
            <Link href="/forgot-password" className="w-full">
              <Button variant="outline" className="w-full">
                Request new link
              </Button>
            </Link>
          )}
          
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

'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Mail, AlertCircle } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export function EmailForm() {
  const supabase = createClient();
  const [currentEmail, setCurrentEmail] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (mounted && user?.email) {
        setCurrentEmail(user.email);
      }
    });
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    const cleanNext = next.trim();
    const cleanConfirm = confirm.trim();

    if (!cleanNext || !cleanConfirm) {
      setError("Please fill in both fields.");
      return;
    }

    if (cleanNext !== cleanConfirm) {
      setError("Email addresses do not match.");
      return;
    }

    if (cleanNext === currentEmail) {
      setError("This is already your current email address.");
      return;
    }

    // Basic email validation regex
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanNext)) {
      setError("Please enter a valid email address.");
      return;
    }

    setSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        email: cleanNext,
      }, {
        emailRedirectTo: `${window.location.origin}/email-change/confirm`
      });

      if (updateError) {
        if (updateError.status === 429) {
          setError("Too many requests. Please try again later.");
        } else if (updateError.message.toLowerCase().includes('already registered')) {
          setError("This email address is already registered to another account.");
        } else if (updateError.message.toLowerCase().includes('invalid')) {
          setError("The provided email address is invalid.");
        } else {
          setError(updateError.message);
        }
        return;
      }

      setNext('');
      setConfirm('');
      toast.success("Verification links sent. Please check both your current and new email inboxes.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'A network error occurred. Please try again.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Mail className="size-4 text-primary" />
          Change login email
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          Update the email address used to sign in to your account. Confirmation may be required from both your current and new email addresses.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-email" className="text-foreground">
              Current login email
            </Label>
            <Input
              id="current-email"
              type="email"
              value={currentEmail}
              disabled
              readOnly
              className="bg-muted text-muted-foreground cursor-not-allowed"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-email" className="text-foreground">
                New login email
              </Label>
              <Input
                id="new-email"
                type="email"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="email"
                disabled={saving}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-email" className="text-foreground">
                Confirm new login email
              </Label>
              <Input
                id="confirm-email"
                type="email"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="email"
                disabled={saving}
                required
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving || !next || !confirm || next !== confirm}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending confirmation...
                </>
              ) : (
                'Change email'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

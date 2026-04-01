export function DenShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[var(--dls-app-bg)] text-[var(--dls-text-primary)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <span className="absolute inset-x-0 top-0 h-[34rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.85),rgba(246,249,252,0))]" />
        <span className="absolute inset-x-0 top-0 h-[30rem] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_34%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.08),transparent_30%)]" />
      </div>

      <div className="relative z-10  min-h-screen min-h-dvh w-full">
        {children}
      </div>
    </main>
  );
}

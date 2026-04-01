import { DenShell } from "./_components/den-shell";
import { DenFlowProvider } from "./_providers/den-flow-provider";

export default function DenLayout({ children }: { children: React.ReactNode }) {
  return (
    <DenFlowProvider>
      <DenShell>{children}</DenShell>
    </DenFlowProvider>
  );
}

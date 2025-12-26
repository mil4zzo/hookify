export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen flex items-center justify-center bg-background overflow-hidden">{children}</div>;
}

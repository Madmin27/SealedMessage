import dynamic from "next/dynamic";

const HomePageClient = dynamic(
  () => import("../components/HomePageClient").then((module) => module.HomePageClient),
  {
    ssr: false,
    loading: () => (
      <main className="flex flex-1 flex-col gap-6">
        <div className="space-y-4 rounded-[28px] border border-cyber-blue/20 bg-brand-panel/75 p-6 shadow-glow-blue-strong">
          <p className="text-sm text-text-light/60">Loading...</p>
        </div>
      </main>
    ),
  }
);

export default function HomePage() {
  return <HomePageClient />;
}

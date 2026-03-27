import { BackgroundEffects } from "@/components/BackgroundEffects";
import { DashboardPreview } from "@/components/DashboardPreview";
import { FeatureCards } from "@/components/FeatureCards";
import { HeroSection } from "@/components/HeroSection";
import { LoginPreview } from "@/components/LoginPreview";
import { TechStack } from "@/components/TechStack";

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-[#040404] text-white">
      <BackgroundEffects />

      <div className="relative z-10">
        <HeroSection />

        <div className="space-y-16 pb-16 sm:space-y-20">
          <FeatureCards />

          <section
            id="demo"
            className="mx-auto grid w-full max-w-[1500px] gap-8 px-6 xl:grid-cols-[minmax(0,1.3fr)_420px]"
          >
            <DashboardPreview />
            <div className="xl:pt-14">
              <LoginPreview />
            </div>
          </section>

          <TechStack />
        </div>
      </div>
    </main>
  );
}

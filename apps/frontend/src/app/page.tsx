import { Hero } from "@/components/sections/hero";
import { ProblemGap } from "@/components/sections/problem-gap";
import { OrbitFlow } from "@/components/sections/orbit-flow";
import { FeaturesToolkit } from "@/components/sections/features-toolkit";
import { UseCases } from "@/components/sections/use-cases";
import { DeveloperSdk } from "@/components/sections/developer-sdk";
import { MvpBoundaries } from "@/components/sections/mvp-boundaries";
import { CtaBanner } from "@/components/sections/cta-banner";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <ProblemGap />
      <OrbitFlow />
      <FeaturesToolkit />
      <UseCases />
      <DeveloperSdk />
      <MvpBoundaries />
      <CtaBanner />
    </main>
  );
}

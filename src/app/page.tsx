import type { Metadata } from "next";
import { LandingHero } from "@/components/landing/landing-hero";
import { HeroShowcase } from "@/components/landing/hero-showcase";
import { RoutesAndCampuses } from "@/components/landing/routes-and-campuses";
import { HowItWorks } from "@/components/landing/how-it-works";
import { SafetyStandards } from "@/components/landing/safety-standards";
import { LandingFAQ } from "@/components/landing/landing-faq";
import { LandingCTA } from "@/components/landing/landing-cta";
import { LandingFooter } from "@/components/landing/landing-footer";
import { APP_NAME, UNIVERSITY_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${APP_NAME} — Official Campus Mobility Platform | ${UNIVERSITY_NAME}`,
  description:
    "Official bus booking and campus transit platform for Cosmopolitan University, Abuja. 32-passenger operating capacity (20 seated, 12 standing), scheduled departure timetables, and digital QR boarding passes.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#F6F8FA] flex flex-col antialiased selection:bg-[#20A477] selection:text-white scroll-smooth">
      <LandingHero />
      <HeroShowcase />
      <RoutesAndCampuses />
      <HowItWorks />
      <SafetyStandards />
      <LandingFAQ />
      <LandingCTA />
      <LandingFooter />
    </div>
  );
}

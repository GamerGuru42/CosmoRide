"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { UNIVERSITY_NAME } from "@/lib/constants";

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: "Who is eligible to book rides on CosmoRide?",
    answer:
      `Any currently enrolled ${UNIVERSITY_NAME} student or authorized university staff member. Access is strictly authenticated via your official @cosmopolitan.edu.ng Google Workspace account. Personal email accounts (such as @gmail.com or @yahoo.com) cannot be registered.`,
  },
  {
    question: "How does the 15-minute booking cutoff work?",
    answer:
      "To ensure disciplined, punctual departures, seat reservations automatically close exactly 15 minutes prior to the scheduled departure time (anchored to West Africa Time / WAT). This allows the Hostel Representative and Bus Driver to finalize the certified passenger manifest before boarding opens.",
  },
  {
    question: "How do I board the shuttle with my digital pass?",
    answer:
      "Once you book a seat, your encrypted QR Boarding Pass is immediately available in your student portal. When the shuttle arrives at your pickup stop, present your QR pass on your phone screen to the Hostel Representative at the bus door for optical camera scanning.",
  },
  {
    question: "What happens if a scheduled journey is full?",
    answer:
      "CosmoRide strictly enforces a safe capacity ceiling of 30 seated passengers per bus — zero standees are permitted. When all 30 seats are booked, you can join the automated priority waitlist. If another passenger cancels their reservation, waitlisted students are automatically promoted.",
  },
  {
    question: "Can I cancel my reservation if my schedule changes?",
    answer:
      "Yes. You can cancel any confirmed booking directly from your student portal up until the 15-minute cutoff window. Cancelling promptly is strongly encouraged as it instantly frees your seat for waiting peers.",
  },
  {
    question: "Which campuses and hostels are currently connected?",
    answer:
      "CosmoRide currently services four core daily routes connecting Main Campus (Central Bus Park), Kado Campus (Academic Wing A Terminal), Main Boys' Hostel (Kado), and Wuye Boys' Hostel, operating Monday through Friday.",
  },
  {
    question: "What should I do if my student profile is incomplete?",
    answer:
      "Upon your first sign-in via Google, you will be guided through a simple one-time registration form to enter your official student matriculation number. Once verified, your account is permanently linked and ready for bookings.",
  },
];

export function LandingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  function toggleFAQ(index: number) {
    setOpenIndex(openIndex === index ? null : index);
  }

  return (
    <section id="faq" className="py-20 lg:py-28 bg-[#102D4A] text-white relative">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-bold text-emerald-400 mb-3 border border-white/10">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Got Questions?</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-300">
            Everything you need to know about booking, boarding, and riding on CosmoRide.
          </p>
        </div>

        {/* Clean Accordion List */}
        <div className="divide-y divide-white/10 border-t border-b border-white/10">
          {FAQS.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div key={faq.question} className="py-5">
                <button
                  type="button"
                  onClick={() => toggleFAQ(index)}
                  className="flex w-full items-center justify-between text-left text-sm sm:text-base font-bold text-white hover:text-emerald-300 transition-colors focus:outline-none"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4">{faq.question}</span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-emerald-400" : ""
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="pt-3 pr-6 text-xs sm:text-sm text-slate-300 leading-relaxed animate-in fade-in duration-150">
                    {faq.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

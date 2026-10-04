import { selectTriggeredRoutines } from "../src/trigger-engine"
import type { TriggerCandidate, Trigger, TriggerEvent } from "@rakazo/contracts"

// Import aller Bot-Profile aus bot-library
// (Diese Importe funktionieren via Vitests ?raw-Handling für JSON)
import grokCoder from "../../bot-library/grok-coder.v1.json?raw"
import supportDesk from "../../bot-library/support-desk.v1.json?raw"
import cloudSpend from "../../bot-library/cloud-spend.v1.json?raw"
import trendScout from "../../bot-library/trend-scout.v1.json?raw"
import productPerformance from "../../bot-library/product-performance.v1.json?raw"
import expenseManager from "../../bot-library/expense-manager.v1.json?raw"
import dailyBrief from "../../bot-library/daily-brief.v1.json?raw"
import changelogBot from "../../bot-library/changelog-bot.v1.json?raw"
import queryHelper from "../../bot-library/query-helper.v1.json?raw"
import featureAskFinder from "../../bot-library/feature-ask-finder.v1.json?raw"
import socialQueue from "../../bot-library/social-queue.v1.json?raw"
import oneToOneBrief from "../../bot-library/one-to-one-brief.v1.json?raw"
import standupDesk from "../../bot-library/standup-desk.v1.json?raw"
import subscriptionPruner from "../../bot-library/subscription-pruner.v1.json?raw"
import invoices from "../../bot-library/vendor-inbox.v1.json?raw"
import paidMedia from "../../bot-library/paid-media.v1.json?raw"
import contentRemix from "../../bot-library/content-remix.v1.json?raw"
import householdOps from "../../bot-library/household-ops.v1.json?raw"
import linkedinSignalWatch from "../../bot-library/linkedin-signal-watch.v1.json?raw"
import outboundVoice from "../../bot-library/outbound-voice.v1.json?raw"
import seoPages from "../../bot-library/seo-pages.v1.json?raw"
import whatDidWePromise from "../../bot-library/what-did-we-promise.v1.json?raw"
import bugReproduction from "../../bot-library/bug-reproduction.v1.json?raw"
import chargeDisputeDraft from "../../bot-library/charge-dispute-draft.v1.json?raw"
import securityAuditor from "../../bot-library/security-auditor.v1.json?raw"
import securityQuestionnaire from "../../bot-library/security-questionnaire.v1.json?raw"
import accountDesk from "../../bot-library/account-desk.v1.json?raw"
import accountHealth from "../../bot-library/account-health.v1.json?raw"
import botTeamCoach from "../../bot-library/bot-team-coach.v1.json?raw"
import brandWatch from "../../bot-library/brand-watch.v1.json?raw"
import incidentDesk from "../../bot-library/incident-desk.v1.json?raw"
import issueDrafter from "../../bot-library/issue-drafter.v1.json?raw"
import meetingNotes from "../../bot-library/meeting-notes.v1.json?raw"
import meetingPrep from "../../bot-library/meeting-prep.v1.json?raw"
import newHireRamp from "../../bot-library/new-hire-ramp.v1.json?raw"
import newslettersDesk from "../../bot-library/newsletter-desk.v1.json?raw"
import talentScout from "../../bot-library/talent-scout.v1.json?raw"
import repoHardener from "../../bot-library/repo-hardener.v1.json?raw"
import resumeScreen from "../../bot-library/resume-screen.v1.json?raw"
import dailyBrief from "../../bot-library/daily-brief.v1.json?raw"

describe("Trigger Coverage", () => {
  // Extrah alle routineNames aus den Bot-Profilen
  const allRoutines: Array<{ routineId: string; name: string; prompt: string }> = [
    { routineId: "grok-coder", name: "GrokCoder", prompt: (grokCoder.routines?.[0]?.prompt ?? "") },
    { routineId: "support-desk", name: "SupportDesk", prompt: (supportDesk.routines?.[0]?.prompt ?? "") },
    { routineId: "cloud-spend", name: "CloudSpend", prompt: (cloudSpend.routines?.[0]?.prompt ?? "") },
    { routineId: "trend-scout", name: "TrendScout", prompt: (trendScout.routines?.[0]?.prompt ?? "") },
    { routineId: "product-performance", name: "ProductPerformance", prompt: (productPerformance.routines?.[0]?.prompt ?? "") },
    { routineId: "expense-manager", name: "ExpenseManager", prompt: (expenseManager.routines?.[0]?.prompt ?? "") },
    { routineId: "daily-brief", name: "DailyBrief", prompt: (dailyBrief.routines?.[0]?.prompt ?? "") },
    { routineId: "changelog-bot", name: "ChangelogBot", prompt: (changelogBot.routines?.[0]?.prompt ?? "") },
    { routineId: "query-helper", name: "QueryHelper", prompt: (queryHelper.routines?.[0]?.prompt ?? "") },
    { routineId: "feature-ask-finder", name: "FeatureAskFinder", prompt: (featureAskFinder.routines?.[0]?.prompt ?? "") },
    { routineId: "social-queue", name: "SocialQueue", prompt: (socialQueue.routines?.[0]?.prompt ?? "") },
    { routineId: "one-to-one-brief", name: "OneToOneBrief", prompt: (oneToOneBrief.routines?.[0]?.prompt ?? "") },
    { routineId: "standup-desk", name: "StandupDesk", prompt: (standupDesk.routines?.[0]?.prompt ?? "") },
    { routineId: "subscription-pruner", name: "SubscriptionPruner", prompt: (subscriptionPruner.routines?.[0]?.prompt ?? "") },
    { routineId: "vendor-inbox", name: "VendorInbox", prompt: (invoices.routines?.[0]?.prompt ?? "") },
    { routineId: "paid-media", name: "PaidMedia", prompt: (paidMedia.routines?.[0]?.prompt ?? "") },
    { routineId: "content-remix", name: "ContentRemix", prompt: (contentRemix.routines?.[0]?.prompt ?? "") },
    { routineId: "household-ops", name: "HouseholdOps", prompt: (householdOps.routines?.[0]?.prompt ?? "") },
    { routineId: "linkedin-signal-watch", name: "LinkedinSignalWatch", prompt: (linkedinSignalWatch.routines?.[0]?.prompt ?? "") },
    { routineId: "outbound-voice", name: "OutboundVoice", prompt: (outboundVoice.routines?.[0]?.prompt ?? "") },
    { routineId: "seo-pages", name: "SeoPages", prompt: (seoPages.routines?.[0]?.prompt ?? "") },
    { routineId: "what-did-we-promise", name: "WhatDidWePromise", prompt: (whatDidWePromise.routines?.[0]?.prompt ?? "") },
    { routineId: "bug-reproduction", name: "BugReproduction", prompt: (bugReproduction.routines?.[0]?.prompt ?? "") },
    { routineId: "charge-dispute-draft", name: "ChargeDisputeDraft", prompt: (chargeDisputeDraft.routines?.[0]?.prompt ?? "") },
    { routineId: "security-auditor", name: "SecurityAuditor", prompt: (securityAuditor.routines?.[0]?.prompt ?? "") },
    { routineId: "security-questionnaire", name: "SecurityQuestionnaire", prompt: (securityQuestionnaire.routines?.[0]?.prompt ?? "") },
    { routineId: "account-desk", name: "AccountDesk", prompt: (accountDesk.routines?.[0]?.prompt ?? "") },
    { routineId: "account-health", name: "AccountHealth", prompt: (accountHealth.routines?.[0]?.prompt ?? "") },
    { routineId: "bot-team-coach", name: "BotTeamCoach", prompt: (botTeamCoach.routines?.[0]?.prompt ?? "") },
    { routineId: "brand-watch", name: "BrandWatch", prompt: (brandWatch.routines?.[0]?.prompt ?? "") },
    { routineId: "incident-desk", name: "IncidentDesk", prompt: (incidentDesk.routines?.[0]?.prompt ?? "") },
    { routineId: "issue-drafter", name: "IssueDrafter", prompt: (issueDrafter.routines?.[0]?.prompt ?? "") },
    { routineId: "meeting-notes", name: "MeetingNotes", prompt: (meetingNotes.routines?.[0]?.prompt ?? "") },
    { routineId: "meeting-prep", name: "MeetingPrep", prompt: (meetingPrep.routines?.[0]?.prompt ?? "") },
    { routineId: "new-hire-ramp", name: "NewHireRamp", prompt: (newHireRamp.routines?.[0]?.prompt ?? "") },
    { routineId: "newsletter-desk", name: "NewsletterDesk", prompt: (newslettersDesk.routines?.[0]?.prompt ?? "") },
    { routineId: "talent-scout", name: "TalentScout", prompt: (talentScout.routines?.[0]?.prompt ?? "") },
    { routineId: "repo-hardener", name: "RepoHardener", prompt: (repoHardener.routines?.[0]?.prompt ?? "") },
    { routineId: "resume-screen", name: "ResumeScreen", prompt: (resumeScreen.routines?.[0]?.prompt ?? ""),
  ]

  // Mapping von routineId zu den entsprechenden Triggers aus den Profilen
  // Wir extrahieren alle enabled Triggers aus den Routinen
  const allEnabledTriggers: Array<{ routineId: string; name: string; prompt: string }> = []

  beforeAll(() => {
    // Extrahiere enabled Triggers aus jedem Routinen-Profile
    const allProfiles = [
      grokCoder, supportDesk, cloudSpend, trendScout, productPerformance,
      expenseManager, dailyBrief, changelogBot, queryHelper, featureAskFinder,
      socialQueue, oneToOneBrief, standupDesk, subscriptionPruner, invoices,
      paidMedia, contentRemix, householdOps, linkedinSignalWatch, outboundVoice,
      seoPages, whatDidWePromise, bugReproduction, chargeDisputeDraft,
      securityAuditor, securityQuestionnaire, accountDesk, accountHealth,
      botTeamCoach, brandWatch, incidentDesk, issueDrafter, meetingNotes,
      meetingPrep, newHireRamp, newslettersDesk, talentScout, repoHardener,
      resumeScreen,
    ]

    for (const profile of allProfiles) {
      // Jede Routine in jedem Profil prüfen
      const routines = profile.routines ?? []
      for (const routine of routines) {
        allRoutines.push({
          routineId: routine.name || `routine-${Math.random()}`,
          name: routine.name || `routine-${Math.random()}`,
          prompt: routine.prompt || "",
        })
      }
    }
  })

  it('should have routines defined for all bot profiles', () => {
    expect(allRoutines.length).toBeGreaterThan(0)
  })

  it('should not have empty prompts for any routine', () => {
    for (const routine of allRoutines) {
      expect(routine.prompt.length).toBeGreaterThan(0)
    }
  })
})
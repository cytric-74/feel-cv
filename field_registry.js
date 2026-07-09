// field_registry.js — Single source of truth for all FeelCV profile fields.
// Loaded as a plain script in popup.html AND as the first entry in
// manifest.json content_scripts, so both popup.js and content.js can
// reference window.FCV_FIELD_REGISTRY without duplication.

"use strict";

window.FCV_FIELD_REGISTRY = {
  // ── Identity ──────────────────────────────────────────────────────────────
  full_name: {
    label: "Full Name",
    patterns: ["full name", "your name", "applicant name", "candidate name"]
  },
  first_name: {
    label: "First Name",
    patterns: ["first name", "given name", "forename", "first"]
  },
  last_name: {
    label: "Last Name",
    patterns: ["last name", "surname", "family name", "last"]
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  email: {
    label: "Email",
    patterns: ["email address", "email", "e-mail", "mail"]
  },
  phone: {
    label: "Phone",
    patterns: ["phone number", "mobile number", "contact number", "telephone", "mobile", "phone", "cell"]
  },
  location: {
    label: "Location / City",
    patterns: ["current location", "where are you based", "city", "location", "address", "town"]
  },

  // ── Online presence ───────────────────────────────────────────────────────
  linkedin: {
    label: "LinkedIn URL",
    patterns: ["linkedin profile", "linkedin url", "linkedin"]
  },
  github: {
    label: "GitHub URL",
    patterns: ["github url", "github profile", "github"]
  },
  portfolio: {
    label: "Portfolio URL",
    patterns: ["portfolio url", "portfolio", "personal site", "personal url", "website"]
  },

  // ── Professional summary ──────────────────────────────────────────────────
  summary: {
    label: "About / Summary",
    patterns: ["professional summary", "profile summary", "about yourself", "tell us about yourself", "describe yourself", "brief bio", "short bio", "about you", "summary", "bio"]
  },
  headline: {
    label: "Professional Headline",
    patterns: ["current position", "current designation", "current role", "job title", "designation", "headline", "title"]
  },

  // ── Experience ────────────────────────────────────────────────────────────
  years_experience: {
    label: "Years of Experience",
    patterns: ["years of experience", "total experience", "how many years", "work experience"]
  },
  current_company: {
    label: "Current Employer",
    patterns: ["current organization", "current employer", "current company", "employer"]
  },
  current_role: {
    label: "Current Job Title",
    patterns: ["current designation", "current position", "current title", "current role"]
  },
  work_history: {
    label: "Work History",
    patterns: ["employment history", "work history", "past experience", "previous companies"]
  },
  projects: {
    label: "Projects",
    patterns: ["notable projects", "key projects", "personal projects", "project experience", "projects"]
  },

  // ── Education ─────────────────────────────────────────────────────────────
  degree: {
    label: "Degree",
    patterns: ["highest qualification", "academic qualification", "qualification", "education", "degree"]
  },
  university: {
    label: "University / College",
    patterns: ["university", "college", "institution", "school", "alma mater"]
  },
  graduation_year: {
    label: "Graduation Year",
    patterns: ["graduation year", "year of graduation", "passed out", "batch"]
  },
  major: {
    label: "Field of Study",
    patterns: ["field of study", "specialization", "stream", "branch", "course", "major"]
  },

  // ── Skills ────────────────────────────────────────────────────────────────
  skills: {
    label: "Skills",
    patterns: ["technical skills", "tech stack", "technologies", "competencies", "expertise", "tools", "skills"]
  },
  languages: {
    label: "Programming Languages",
    patterns: ["programming languages", "languages known", "coding languages"]
  },

  // ── Application-specific ─────────────────────────────────────────────────
  cover_letter: {
    label: "Cover Letter",
    patterns: ["motivation letter", "statement of purpose", "cover letter", "why should we hire"]
  },
  motivation: {
    label: "Why this role / company",
    patterns: ["reason for applying", "what interests you", "what attracts you", "why are you interested", "why this company", "why this role", "why do you want"]
  },
  strengths: {
    label: "Key Strengths",
    patterns: ["greatest strengths", "what are your strengths", "key strengths", "strengths"]
  },
  achievements: {
    label: "Achievements",
    patterns: ["accomplishments", "proud of", "achievements"]
  },
  certifications: {
    label: "Certifications",
    patterns: ["certifications", "certificates", "licenses", "credentials"]
  },
  awards: {
    label: "Awards",
    patterns: ["awards", "honors", "honours", "recognitions"]
  },
  salary: {
    label: "Expected Salary",
    patterns: ["salary expectation", "expected salary", "expected ctc", "compensation", "ctc"]
  },
  notice_period: {
    label: "Notice Period",
    patterns: ["when can you join", "notice period", "availability", "how soon"]
  }
};

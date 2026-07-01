import type { Issue } from "../domain/model.js";

export interface IssueStateSnapshot {
  id: string;
  identifier: string;
  state: string;
}

export interface TrackerLifecycleConfig {
  claimState: string | null;
  handoffStates: readonly string[];
  blockedState: string | null;
  requireClaimBeforeAgent: boolean;
}

export interface TrackerHandoffMetadata {
  readyForReview: boolean;
  prUrl: string | null;
  prNumber: string | null;
  headSha: string | null;
  validationSummary: string | null;
  risks: string | null;
}

export interface TrackerLifecycleTransitionResult {
  issue: IssueStateSnapshot;
  state: string;
}

export type TrackerHandoffRunResult =
  | {
      status: "succeeded";
      result: TrackerLifecycleTransitionResult;
      metadata: TrackerHandoffMetadata;
    }
  | {
      status: "failed";
      error: string;
      metadata: TrackerHandoffMetadata;
    };

export interface IssueTracker {
  fetchCandidateIssues(): Promise<Issue[]>;
  fetchIssuesByStates(stateNames: string[]): Promise<Issue[]>;
  fetchIssueStatesByIds(issueIds: string[]): Promise<IssueStateSnapshot[]>;
  claimIssue?(input: {
    issue: Issue;
    lifecycle: TrackerLifecycleConfig;
  }): Promise<TrackerLifecycleTransitionResult>;
  handoffIssue?(input: {
    issue: Issue;
    lifecycle: TrackerLifecycleConfig;
    metadata: TrackerHandoffMetadata;
  }): Promise<TrackerLifecycleTransitionResult>;
}

export type WriteCapableIssueTracker = IssueTracker &
  Required<Pick<IssueTracker, "claimIssue" | "handoffIssue">>;

export function supportsTrackerLifecycleWrite(
  tracker: IssueTracker,
): tracker is WriteCapableIssueTracker {
  return (
    typeof tracker.claimIssue === "function" &&
    typeof tracker.handoffIssue === "function"
  );
}

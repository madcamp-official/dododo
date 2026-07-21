import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import type { UserProfile } from "../../../../../packages/shared/src/index.ts";
import { runResult, type Result } from "./result.ts";

export async function getProfile(container: CliContainer): Promise<Result<UserProfile | undefined>> {
  return runResult(() => container.profileRepository.get());
}

export async function saveProfile(container: CliContainer, profile: UserProfile): Promise<Result<void>> {
  return runResult(() => container.profileRepository.save(profile));
}

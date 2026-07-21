import type { CliContainer } from "../../../../cli/src/runtime/container.ts";
import type { UserProfile } from "../../../../../packages/shared/src/index.ts";
import { toResult, type Result } from "./result.ts";

export async function getProfile(container: CliContainer): Promise<Result<UserProfile | undefined>> {
  return toResult(() => container.profileRepository.get());
}

export async function saveProfile(container: CliContainer, profile: UserProfile): Promise<Result<void>> {
  return toResult(() => container.profileRepository.save(profile));
}

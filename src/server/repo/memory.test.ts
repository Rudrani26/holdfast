import { describeRepoContract } from "./contract";
import { MemoryRepo } from "./memory";

describeRepoContract("MemoryRepo", () => new MemoryRepo());

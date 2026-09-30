// Live listings from the 321honeydone Drive and Jobber, captured 2026-09-30
// with the Drive and Jobber connectors. Ids, names, sizes and upload times are
// real. EXIF (imageMediaMetadata.time) is NOT exposed by the connector, so the
// fixtures carry exifTime: null unless a test sets it on purpose.
import type { DriveFile, QuoteWindow } from "../../src/lib/photo_loader/types";
import type { DriveReader } from "../../src/lib/photo_loader/folders";

const FOLDER = "application/vnd.google-apps.folder";
export const ROOT = "16ir823EsHr8XcFjxJcfacNZ36wPczak5";

export const folder = (id: string, name: string, parentId: string, createdTime = "2026-09-26T18:12:54.884Z"): DriveFile => ({ id, name, mimeType: FOLDER, parentId, createdTime });
export const jpg = (id: string, name: string, parentId: string, createdTime: string, size?: number, exifTime: string | null = null): DriveFile => ({
  id, name, mimeType: "image/jpeg", parentId, createdTime, size, exifTime, thumbnailLink: `https://lh3.example/${id}=s220`,
});

export const RED_ID = "1zwSIceNKfSl9oIkqGCBcuSaWEZ2V7sNc";
export const STALWART_ID = "1x9OituezNJOvbKIFJ5-b1lT-gsjnY1O-";
export const SARAH_ID = "12oBt3JQEb25W_7UZOzYVIOKhxlCj53kb";
export const PETER_ID = "1P3Wp_ygpY4bnk5bnsLuClHXIahN8QtmL";

export const rootChildren: DriveFile[] = [
  folder(RED_ID, "Real Estate Direct", ROOT),
  folder(SARAH_ID, "Sarah Rohling", ROOT, "2026-09-29T16:32:20.977Z"),
  folder(PETER_ID, "Peter Pappas", ROOT, "2026-09-29T15:17:31.866Z"),
];

export const redChildren: DriveFile[] = [folder(STALWART_ID, "8426 Stalwart Cir", RED_ID, "2026-09-27T22:07:47.695Z")];

/** 8426 Stalwart Cir as listed live on 2026-09-30 (loose in the address folder, no date subfolder). */
export const stalwartChildren: DriveFile[] = [
  jpg("1Ncjpwv42r8fq7BFZuu6QEVcEh2VKnJwp", "PXL_20260929_225623968.jpg", STALWART_ID, "2026-09-29T22:58:17.083Z", 5156427),
  jpg("1JCxp1Lv3EuzmuiIPKsw8H0CC_YxYSbmV", "2026-10-21_platform-removal-new-sod.jpg", STALWART_ID, "2026-09-30T19:05:25.493Z", 1865499),
  jpg("1XSCFkJJEPmsukc-KX-UfTtJWUfDUOIVA", "BA_wood-platform-removal-new-sod.jpg", STALWART_ID, "2026-09-30T19:05:26.879Z", 599071),
  jpg("1IibcmHB7DRlgp319-Xx2gxh31vheBIvf", "PXL_20260929_225606636.jpg", STALWART_ID, "2026-09-29T22:58:17.314Z", 3591576),
  jpg("1bCF5-WL7_2qxQkK1x97px2TSMwqxawqe", "PXL_20260929_225702980.jpg", STALWART_ID, "2026-09-29T22:58:17.029Z", 4675197),
  jpg("17DZKu62W4qjL3_nTgrMmnStVvOUx53pq", "PXL_20260929_225554998.jpg", STALWART_ID, "2026-09-29T22:58:17.199Z", 5937851),
  jpg("1pPD8pfoZVou9Li5_3IuP8P65wog7d5bl", "PXL_20260929_214300654.jpg", STALWART_ID, "2026-09-29T22:58:17.398Z", 5741059),
  jpg("1GzQafxL04XqToRHEeG0hbRBto64bPU4y", "PXL_20260929_214256575.MP.jpg", STALWART_ID, "2026-09-29T22:58:17.497Z", 9011157),
  jpg("17tySVlYKLeJH0BAKBPcpRtyyn0tahK3r", "PXL_20260928_205336273.jpg", STALWART_ID, "2026-09-29T22:58:17.781Z", 5831832),
  jpg("1l_FW8Q7-das8eTfgYO2Hrfiisn3cJgEB", "PXL_20260928_205136554.MP.jpg", STALWART_ID, "2026-09-29T22:58:18.622Z", 7166854),
  jpg("1ZWPjGHg5DvvHUBaGqvpHRlgnqcggGuF1", "PXL_20260928_205030329.jpg", STALWART_ID, "2026-09-29T22:58:18.558Z", 5073585),
  jpg("1ujecSveesTZksNp9vvSYXaT1u0UW2BP8", "PXL_20260928_205142404.jpg", STALWART_ID, "2026-09-29T22:58:18.480Z", 5872644),
  jpg("16Z_KIvQ4Th430EcgT00wjCVsJOwp0LDw", "PXL_20260928_205021675.jpg", STALWART_ID, "2026-09-29T22:58:18.433Z", 5122996),
  jpg("1rj8ivAEPeVQOYs9tmJiPYPZ1I7tcPQRx", "PXL_20260928_205425572.MP.jpg", STALWART_ID, "2026-09-29T22:58:17.872Z", 7287076),
  jpg("1ir5UMW1GTE-OKKPTrfiYAz1dcK-IlcEk", "PXL_20260928_205030329.jpg", STALWART_ID, "2026-09-28T20:55:54.151Z", 5073585),
  jpg("1O8QJT0orQfX_VtEaQ_SPcDrxVVCUB1N2", "17906290156445631242363919173876.jpg", STALWART_ID, "2026-09-28T20:57:09.813Z", 4129013),
  jpg("1WZEEZSCNaggIQRHUeZXR-jv612xkKSPx", "PXL_20260928_205021675.jpg", STALWART_ID, "2026-09-28T20:56:02.557Z", 5122996),
  jpg("1tYM-5sa1-N341E5w6qxAPDyHazi_PorO", "PXL_20260928_205136554.MP.jpg", STALWART_ID, "2026-09-28T20:55:38.871Z", 7166854),
  jpg("1cQFqzc2koFruXItdnjbalBd2DGqUuJ3g", "PXL_20260928_205142404.jpg", STALWART_ID, "2026-09-28T20:55:34.330Z", 5872644),
  jpg("1PRfPNAJmIQvqRqrDMjhpG97NmNuaiCRw", "PXL_20260928_205336273.jpg", STALWART_ID, "2026-09-28T20:55:30.023Z", 5831832),
  jpg("1ND23jxqcKg8veIuBP9jF0AgItsg76iks", "PXL_20260928_205425572.MP.jpg", STALWART_ID, "2026-09-28T20:55:05.315Z", 7287076),
  { id: "1TWA0j1J4Oimd6j2sNFAv8QmwEIz8ObcN", name: "Screenshot_20260926-141103.png", mimeType: "image/png", parentId: STALWART_ID, createdTime: "2026-09-26T18:12:56.058Z", size: 2127468, exifTime: null },
];

export const sarahChildren: DriveFile[] = [
  jpg("1Y3ASm-kN9pi7KQh1YbVPIhaVa3eqEdpa", "02.jpg", SARAH_ID, "2026-09-29T16:32:21.009Z", 7281044),
  jpg("1Q8PWYu3haPQ_N6azUjnRM0Zqq3SZoRwf", "01.jpg", SARAH_ID, "2026-09-29T16:32:20.994Z", 4886273),
  jpg("1KIiYJulo7AxAR6Fd3FLz-qXMtYEYGc4e", "03.jpg", SARAH_ID, "2026-09-29T16:32:21.025Z", 6825992),
];

export const peterChildren: DriveFile[] = [jpg("1GSrn_Lz2eICGdbGgE0SvfdTnKbzAKoOb", "IMG_20260929_203611.jpg", PETER_ID, "2026-09-30T00:36:42.534Z", 631843)];

/** Jobber, live 2026-09-30. */
export const stalwartQuote: QuoteWindow = {
  id: "EST-10010",
  label: "Bulk Pickup (EST-10010) · Jobber #20260088",
  sawbuckEstimateId: "EST-10010",
  jobberQuoteNumber: "20260088",
  createdAt: "2026-09-28T02:15:27Z",
  approvedAt: "2026-09-29T12:46:46Z",
  jobCompletedAt: "2026-09-30T13:09:16Z",
};
export const peterQuote: QuoteWindow = {
  id: "EST-10011",
  label: "General work (EST-10011) · Jobber #20260089",
  sawbuckEstimateId: "EST-10011",
  jobberQuoteNumber: "20260089",
  createdAt: "2026-09-29T16:43:32Z",
  approvedAt: "2026-09-30T16:17:50Z",
  jobCompletedAt: null,
};

/** In-memory Drive built from listings. */
export function fakeDrive(tree: Record<string, DriveFile[]>): DriveReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async listChildren(folderId: string) {
      calls.push(folderId);
      return tree[folderId] ?? [];
    },
  };
}

export const liveTree: Record<string, DriveFile[]> = {
  [ROOT]: rootChildren,
  [RED_ID]: redChildren,
  [STALWART_ID]: stalwartChildren,
  [SARAH_ID]: sarahChildren,
  [PETER_ID]: peterChildren,
};

export const NOW = Date.parse("2026-09-30T21:00:00Z");

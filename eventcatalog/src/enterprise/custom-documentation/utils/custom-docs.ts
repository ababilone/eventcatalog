// import { getCollection } from "astro:content";
import config from '@config';
import fs from 'node:fs';
import path from 'node:path';
import { getEntry } from 'astro:content';
import matter from 'gray-matter';

type Badge = {
  text: string;
  color: string;
};

type SidebarItem = {
  label: string;
  slug?: string;
  items?: SidebarItem[];
  badge?: Badge;
  collapsed?: boolean;
};

type SideBarConfigurationItem = {
  label: string;
  items?: SidebarItem[];
  slug?: string;
  autogenerated?: {
    directory: string;
  };
  badge?: Badge;
  collapsed?: boolean;
};

type AdjacentPage = {
  label: string;
  slug: string;
};

type AdjacentPages = {
  prev: AdjacentPage | null;
  next: AdjacentPage | null;
};

const DOCS_DIR = 'docs';

/**
 * Processes auto-generated directory and returns navigation items
 */
const processAutoGeneratedDirectory = async (
  directory: string,
  label: string,
  badge?: Badge,
  collapsed?: boolean
): Promise<SidebarItem> => {
  // @ts-ignore
  const files = fs.readdirSync(path.join(process.env.PROJECT_DIR || '', DOCS_DIR, directory));

  // Convert files to frontmatter
  const docsWithFrontmatter = files.map((file) => {
    // @ts-ignore
    const content = fs.readFileSync(path.join(process.env.PROJECT_DIR || '', DOCS_DIR, directory, file), 'utf8');
    const { data } = matter(content);
    return { ...data, file };
  });

  // If user defined slug use it, otherwise use the file
  const astroIdsForFiles = docsWithFrontmatter.map(
    (doc: any) => doc.slug || path.join(DOCS_DIR, directory, doc.file).replace('.mdx', '')
  );

  const entries = await Promise.all(
    astroIdsForFiles.map(async (astroId) => {
      const entry = await getEntry('customPages', astroId);
      return entry;
    })
  );

  // Filter anything we haven't found
  const filteredEntries = entries.filter((entry) => entry !== undefined);

  return {
    label,
    items: filteredEntries.map((entry) => ({
      label: entry?.data?.title,
      slug: entry?.data?.slug || entry?.id.replace(DOCS_DIR, ''),
    })),
  };
};

/**
 * Recursively process sidebar items to handle auto-generated content at any nesting level
 */
const processSidebarItems = async (items: SideBarConfigurationItem[]): Promise<SidebarItem[]> => {
  const processedItems: SidebarItem[] = [];

  for (const item of items) {
    // If item has autogenerated property, process it
    if (item.autogenerated) {
      const processedItem = await processAutoGeneratedDirectory(
        item.autogenerated.directory,
        item.label,
        item.badge,
        item.collapsed
      );
      processedItems.push(processedItem);
    }
    // If item has nested items, process them recursively
    else if (item.items && item.items.length > 0) {
      const processedNestedItems = await processSidebarItems(item.items as SideBarConfigurationItem[]);
      processedItems.push({
        label: item.label,
        slug: item.slug,
        items: processedNestedItems,
        badge: item.badge,
        collapsed: item.collapsed,
      });
    }
    // Otherwise, it's a regular item
    else {
      processedItems.push(item as SidebarItem);
    }
  }

  return processedItems;
};

/**
 * Flatten all navigation items into a single array of pages with slugs
 * This is used to find previous and next pages for navigation
 */
const flattenNavigationItems = (items: SidebarItem[]): AdjacentPage[] => {
  const flatPages: AdjacentPage[] = [];

  const processItem = (item: SidebarItem) => {
    // Add the current item if it has a slug
    if (item.slug) {
      flatPages.push({
        label: item.label,
        slug: item.slug,
      });
    }

    // Process nested items if they exist
    if (item.items && item.items.length > 0) {
      item.items.forEach(processItem);
    }
  };

  items.forEach(processItem);
  return flatPages;
};

/**
 * Get the previous and next pages for a given slug
 * Returns null for prev if it's the first page, and null for next if it's the last page
 */
export const getAdjacentPages = async (slug: string): Promise<AdjacentPages> => {
  const navigationItems = await getNavigationItems();
  const flatPages = flattenNavigationItems(navigationItems);

  // Normalize the slug by removing 'docs/' prefix if it exists
  // and ensure consistent formatting with or without leading slash
  let normalizedSlug = slug;
  if (normalizedSlug.startsWith('docs/')) {
    normalizedSlug = normalizedSlug.substring(5); // Remove 'docs/' prefix
  }

  // Find the current page by comparing normalized slugs
  const currentIndex = flatPages.findIndex((page) => {
    // Normalize page slug for comparison
    let pageSlug = page.slug;
    if (pageSlug.startsWith('/')) {
      pageSlug = pageSlug.substring(1);
    }

    return pageSlug === normalizedSlug;
  });

  // If page not found, return null for both prev and next
  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  // Get previous page if it exists
  const prev = currentIndex > 0 ? flatPages[currentIndex - 1] : null;

  // Get next page if it exists
  const next = currentIndex < flatPages.length - 1 ? flatPages[currentIndex + 1] : null;

  return { prev, next };
};

export const getNavigationItems = async (): Promise<SidebarItem[]> => {
  const configuredSidebar = config.customDocs.sidebar;
  return processSidebarItems(configuredSidebar as SideBarConfigurationItem[]);
};

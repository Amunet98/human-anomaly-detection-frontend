import { createStyles, Container, Group, ActionIcon, rem } from "@mantine/core";
import {
  IconBrandTwitter,
  IconBrandInstagram,
  IconBrandFacebook,
} from "@tabler/icons-react";
import { MantineLogo } from "@mantine/ds";

const useStyles = createStyles((theme) => ({
  footer: {
    display: "flex",
    width: "100%",
    marginTop: rem(120),
    borderTop: `${rem(1)} solid ${theme.colorScheme === "dark" ? theme.colors.dark[5] : theme.colors.gray[2]
      }`,
  },

  inner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,

    [theme.fn.smallerThan("xs")]: {
      flexDirection: "column",
    },
  },

  links: {
    [theme.fn.smallerThan("xs")]: {
      marginTop: theme.spacing.md,
    },
  },
}));

export function FooterLinks() {
  return (
    <div className=" flex justify-center self-center mt-8 bottom-0 fixed">
      <div>
        <span className="flex  flex-row justify-center rounded-lg pl-36 pr-36 w-auto self-center bg-black">
          <span className="self-center text-lg mr-1">
            Made In <em>"AIT"</em> By "Bimesh Poudel and Prasanna singh k.c." with
          </span>
          <span className="text-3xl">
            💗
          </span>
        </span>
      </div>
    </div>
  )
}

import { IconExternalLink } from '@tabler/icons-react';

// The work this system is actually built on. Each entry's title, first author
// and year were checked against arXiv or Crossref rather than written from
// memory; `relevance` says what the paper contributes *here*, so the list
// documents the pipeline instead of being a generic reading list.
const referencePapers = [
    {
        title: 'You Only Look Once: Unified, Real-Time Object Detection',
        authors: 'Redmon et al.',
        venue: 'arXiv:1506.02640',
        year: 2015,
        relevance:
            'The original YOLO paper: a single network predicting boxes and class probabilities in one pass. This demo runs a YOLOv8 descendant of it, which is what makes detection cheap enough to run in a browser tab.',
        link: 'https://arxiv.org/abs/1506.02640',
    },
    {
        title:
            'YOLO-Pose: Enhancing YOLO for Multi Person Pose Estimation Using Object Keypoint Similarity Loss',
        authors: 'Maji et al.',
        venue: 'arXiv:2204.06806',
        year: 2022,
        relevance:
            'Extends YOLO to predict keypoints alongside boxes in a single shot. This is the architecture behind the pose model here — the skeleton drawn over each subject comes from exactly this kind of head, and the posture decision is made from those joints.',
        link: 'https://arxiv.org/abs/2204.06806',
    },
    {
        title: 'OpenPose: Realtime Multi-Person 2D Pose Estimation using Part Affinity Fields',
        authors: 'Cao et al.',
        venue: 'arXiv:1812.08008',
        year: 2018,
        relevance:
            'The bottom-up approach that made multi-person pose estimation real-time, and the source of the 17-keypoint COCO skeleton convention this project draws and reasons about.',
        link: 'https://arxiv.org/abs/1812.08008',
    },
    {
        title: 'Fall Detection Based on Key Points of Human-Skeleton Using OpenPose',
        authors: 'Chen et al.',
        venue: 'Symmetry',
        year: 2020,
        relevance:
            'Derives a fall decision from skeleton geometry — torso angle and the speed of the hip-centre descent — rather than training a classifier on raw frames. It is the same argument this project makes: a horizontal torso you can see is more trustworthy than a label you have to accept.',
        link: 'https://doi.org/10.3390/sym12050744',
    },
    {
        title: 'Vision-Based Fall Detection with Convolutional Neural Networks',
        authors: 'Núñez-Marcos et al.',
        venue: 'Wireless Communications and Mobile Computing',
        year: 2017,
        relevance:
            'Uses optical flow over a window of frames rather than a single image, which is the case for why a fall has to be judged over time. The temporal voting here — a detection must persist for over a second before it is confirmed — is the cheap version of that idea.',
        link: 'https://doi.org/10.1155/2017/9474806',
    },
    {
        title: 'Simple Online and Realtime Tracking',
        authors: 'Bewley et al.',
        venue: 'arXiv:1602.00763',
        year: 2016,
        relevance:
            'SORT: associate detections across frames by IoU and a Kalman filter, nothing more. The tracker in this app is a deliberately lighter relative — IoU association without the Kalman step — and it is what gives each subject a stable id to vote on.',
        link: 'https://arxiv.org/abs/1602.00763',
    },
    {
        title: 'Simple Online and Realtime Tracking with a Deep Association Metric',
        authors: 'Wojke et al.',
        venue: 'arXiv:1703.07402',
        year: 2017,
        relevance:
            'DeepSORT adds an appearance embedding so identities survive occlusion. Not used here — the embedding costs more than the detector on a phone — but it is the upgrade path if ids start swapping when two people cross.',
        link: 'https://arxiv.org/abs/1703.07402',
    },
    {
        title: 'Human fall detection on embedded platform using depth maps and wireless accelerometer',
        authors: 'Kwolek & Kepski',
        venue: 'Computer Methods and Programs in Biomedicine',
        year: 2014,
        relevance:
            'The paper accompanying the UR Fall Detection dataset, still one of the standard benchmarks. It fuses depth with a worn accelerometer — a useful contrast with the RGB-only, nothing-to-wear constraint this project works under.',
        link: 'https://doi.org/10.1016/j.cmpb.2014.09.005',
    },
];

export const ReferencePapers = () => (
    <div className="page-gutter py-10 sm:py-16">
        <div className="mx-auto max-w-3xl">
            <header className="text-center">
                <span className="section-tag">References</span>
                <h1 className="mt-4 text-2xl sm:text-3xl font-bold text-head">
                    What this is built on
                </h1>
                <p className="mt-3 mx-auto max-w-prose text-sm text-dim">
                    Detection, pose estimation, tracking and the fall-decision literature behind
                    the live console.
                </p>
            </header>

            <ul className="mt-10 space-y-4">
                {referencePapers.map((paper) => (
                    <li key={paper.link}>
                        <a
                            href={paper.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group block rounded-2xl border border-line bg-raise p-5 sm:p-6 no-underline transition-colors duration-200 hover:border-accent"
                        >
                            <h2 className="text-base sm:text-lg font-semibold text-head transition-colors duration-200 group-hover:text-accent">
                                {paper.title}
                            </h2>

                            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-dim">
                                {paper.authors} · {paper.venue} · {paper.year}
                            </p>

                            {/* Capped independently of the card: at 14px the
                                full 768px card ran 100 characters per line. */}
                            <p className="mt-3 text-sm text-body max-w-prose">{paper.relevance}</p>

                            <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-accent">
                                Read
                                <IconExternalLink size={14} aria-hidden="true" />
                            </span>
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    </div>
);

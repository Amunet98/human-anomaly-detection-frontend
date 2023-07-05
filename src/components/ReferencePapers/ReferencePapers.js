import { Link } from "react-router-dom"

const refrencePapers = [
    {
        title: "Cloud service-oriented architecture (CSoA) for agriculture through internet of things (IoT) and big data",
        intro: "The proposed work aims to revolutionize agriculture by leveraging technological advancements such as Big Data, IoT, and Cloud Computing. It addresses the obstacles faced by farmers, making farming smarter and more efficient. By providing services like crop management, marketing, finance management, e-commerce, and web services through the cloud, the proposed work empowers farmers and reduces unemployment among the youth. This integration of technology not only transforms agriculture into a profitable sector but also contributes to the overall economic growth by enhancing the GDP.",
        link: "https://ieeexplore.ieee.org/document/8191906"
    },
    {
        title: "Architecture to Integrate IoT Networks Using Artificial Intelligence in the Cloud",
        intro: "This paper proposes an algorithm for resource sharing among IoT devices in telecommunications networks. The algorithm is designed for a centralized management architecture controlled by an AI controller, which utilizes machine learning techniques to collect network information. A Function and Service Discovery Protocol (DFSP) is used to announce smart things connecting to the network, facilitated by the queued message telemetry transport protocol (MQTT). The algorithm discovers and allocates resources in the network, leading to improved efficiency and availability compared to conventional communication systems. By integrating IoT devices, the proposed algorithm enhances communication systems in terms of performance and effectiveness.",
        link: "https://www.researchgate.net/publication/338025582_An_Intelligent_Algorithm_for_Resource_Sharing_and_Self-Management_of_Wireless-IoT-Gateway"
    },
    {
        title: "Quality Assessment of Crops using Machine Learning Techniques",
        intro: "Disease in a crop leads to low productivity and in turn leads to huge loss to the farmers. Thus, detection of disease in early stage will be beneficial for farmer so that necessary actions can be taken. This paper discusses supervised machine learning techniques to detect the disease in the plant with the help of the image of the plant. The comparison between classifications techniques are made in order to select model with highest accuracy. The Quadratic SVM results with highest accuracy of 83.3%. This trained model is used for the detection of new disease image..",
        link: "https://ieeexplore.ieee.org/document/8701294"
    },
    {
        title: "Automated Deployment of IoT Networks in Outdoor Scenarios using an Unmanned Ground Vehicle",
        intro: "This work focuses on the integration of robotics and IoT systems to develop a robotic-aided IoT system for the automatic deployment of sensor networks. An Unmanned Ground Vehicle (UGV) is used to identify optimal positions for IoT node deployment in outdoor environments, based on Received Signal Strength Indicator (RSSI) measurements. Accurate robot localization information obtained from odometry, inertial sensors, and GPS is utilized. The IoT nodes employ IPv6 protocol with IEEE 802.15.4 (6TiSCH) technology and multi-hop communications to ensure wide coverage. Experimental results in a real outdoor context demonstrate the feasibility of the system. The robotic-aided approach outperforms manual deployment, improving communication efficiency and achieving a stable IoT network topology.",
        link: "https://ieeexplore.ieee.org/document/9067099"
    },
    {
        title: "A Comprehensive Survey on Internet of Things (IoT) Toward 5G Wireless System",
        intro: "This article presents an overview of the integration of Internet of Things (IoT) in 5G wireless systems. With the growing popularity of wireless technologies, 5G has emerged as a promising solution to meet the demands of high data rates, multiple device connectivity, low-latency quality of service, and low interference. The article discusses the challenges and vision of various communication industries in implementing 5G IoT systems, along with a detailed analysis of the different layers involved. It covers emerging technologies such as 5G new radio, MIMO with beamforming, mm-wave communication, heterogeneous networks, and the role of augmented reality in IoT. Additionally, it addresses topics like low-power wide-area networks, security challenges, and future research directions in the 5G IoT landscape.",
        link: "https://ieeexplore.ieee.org/document/8879484"
    },
    {
        title: "Crop Selection and IoT Based Monitoring System for Precision Agriculture",
        intro: "The proposed work emphasizes the significance of IoT in agriculture, particularly in implementing precision agriculture techniques to meet the increasing demand for food production. By monitoring environmental factors like temperature, humidity, and soil moisture, the system assists farmers in optimizing crop growth and selecting suitable crops based on collected data and environmental conditions. This approach minimizes the risks associated with crop failure, low yield, excessive water usage, and overuse of fertilizers and pesticides. Sensor nodes deployed in the field collect data, which is then analyzed and visualized in the cloud, enabling farmers to make precise and informed decisions for their crops.",
        link: "https://ieeexplore.ieee.org/document/9077713"
    },
    {
        title: "IoT in Agriculture: Irrigation Monitoring and Control System Example",
        intro: "Wireless technologies have become pervasive in our lives, driving the adoption of the Internet of Things (IoT) in various domains, including agriculture. IoT plays a crucial role in environmental monitoring, facilitating efficient problem identification, resource management, and precision agriculture. Precision agriculture utilizes modern technologies, such as IoT and cloud-based services, to enhance yields, profitability, and sustainability by optimizing inputs like water, fertilizers, and land. This paper explores the applications of IoT in agriculture, communication protocols involved, and presents a prototype IoT-based water pipeline monitoring and management system developed in Usak, Turkey, demonstrating the practical implementation of IoT technology in agriculture.",
        link: "https://ieeexplore.ieee.org/document/9279037"
    },
    {
        title: "Automatic Detection and Image Recognition of Precision Agriculture for Citrus Diseases",
        intro: "In recent years, the development of precision agriculture is a new technology. The main reason for the automation of agricultural processes is to save the time and energy required to perform repeated farming tasks and to increase production by treating each crop separately and applying smart agricultural concepts. In this paper, an automatic detection and image recognition of citrus diseases is presented that can help farmer find the disease and identify it from the captured images. This method use YOLO(You Only Look Once) algorithm which is an object detection model to detect and recognize the diseases from citrus leaf images. YOLO can realtime detect the disease and circle around it on the image and video. The dataset includes images of citrus leaf with two kinds of diseases: Citrus Canker, Citrus Greening.",
        link: "https://ieeexplore.ieee.org/document/9301932"
    },
]



export const ReferencePapers = () => {
    return (
        <div className="flex mt-12 flex-col items-center justify-center">
            <span className="font-mono mb-10 font-bold text-3xl ">
                Reference Paper's
            </span>
            <div className="flex flex-col items-center justify-center">
                {
                    refrencePapers.map((item, index) => {
                        return (
                            <div className="w-10/12 outline rounded-lg mb-10 p-7 bg-slate-200">
                                <Link to={item.link}>
                                    <div key={index} className="flex flex-col">
                                        <span className="font-mono mb-3 font-bold text-xl">{item.title}</span>
                                        <span className="font-sans text-blue-800 font-semibold mb-2">{item.link}</span>
                                        <span className="font-serif text-base">{item.intro}</span>
                                    </div>
                                </Link>
                            </div>
                        )
                    })
                }
            </div>
        </div>
    )
}
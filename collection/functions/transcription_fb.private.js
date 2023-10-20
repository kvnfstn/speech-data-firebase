const { FieldPath, FieldValue } = require("firebase-admin/firestore");

const varsHelper = require(Runtime.getFunctions()["vars_helper"].path);
const firebase_helper = require(Runtime.getFunctions()["google_firebase_helper"].path);

/**
 * Add a new transcription row.
 * @param participantRef Ref to the participant document in the firestore DB.
 * @param participantData current participant data
 * @param responseId ID of response being transcribed.
 * @param text Full text of transcription.
 * @return {Promise<void>}
 */
exports.addTranscription = async (participantRef, participantData, responseId, text) => {
  const transcriptionsCol = await firebase_helper.getTranscriptionCollectionRef();
  const responsesCol = await firebase_helper.getResponsesCollectionRef();
  const language = varsHelper.getVar("transcription-language");

  // Add transcription row.
  console.log("Adding transcription document to database");
  transcriptionsCol
    .add({
      creation_date: new Date().toUTCString(),
      transcriber_path: participantRef.path,
      target_language: language,
      text: text,
      status: "New",
      response_path: responsesCol.doc(responseId).path,
    })
    .then((docRef) => {
      console.log("Transcription document successfully added");

      participantData["transcribed_responses"].push(docRef.id); // Passed by reference

      console.log("Updating transcription count in the response document");
      responsesCol
        .doc(responseId)
        .update({
          [`transcription_counts.${language}`]: FieldValue.increment(1),
        })
        .then(() => {
          console.log("Response document successfully updated");
        })
        .catch((error) => {
          console.error("Error updating response document:", error);
        });
    })
    .catch((error) => {
      console.error("Error adding transcription:", error);
    });
};

/**
 * Fetch the next available prompt, filtering out any that have already been
 * responded to or that have reached their limit of transcriptions.
 * @param participantKey ID of participant to be prompted.
 * @param language The language transcriptions are expected in.
 * @return {Promise<{position: number, content: *, id: *, type: *}>}
 */
exports.getNextPrompt = async (transcribedResponses, language) => {
  // Identify used prompts.
  const respColRef = await firebase_helper.getResponsesCollectionRef();
  const notTranscribedRespsQuery = await respColRef
    .where(FieldPath.documentId(), "not-in", transcribedResponses)
    .where(`transcription_counts.${language}`, "<", parseInt(varsHelper.getVar("transcriptions-per-response")));

  // Find unused prompts.
  notTranscribedRespsQuery
    .get()
    .then((querySnapshot) => {
      const matchingResponses = [];
      querySnapshot.forEach((respDocSnapshot) => {
        matchingResponses.push(respDocSnapshot);
      });

      if (matchingResponses.length > 0) {
        const randomIndex = Math.floor(Math.random() * matchingResponses.length);
        const randomResponse = matchingResponses[randomIndex];

        return {
          type: "audio",
          content: randomResponse.get("storage_link"),
          id: randomResponse.id,
          position: transcribedResponses.size + 1,
        };
      } else {
        throw "All available prompts have been seen by this user. Please add more to continue";
      }
    })
    .catch((error) => {
      console.log(error);
    });
};